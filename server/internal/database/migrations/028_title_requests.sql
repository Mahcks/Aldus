CREATE TABLE title_requests (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL REFERENCES users(id),
    work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    external_source TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
    author TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((external_source = '') = (external_id = ''))
);
CREATE INDEX title_requests_library_updated ON title_requests(library_id,updated_at DESC,id);
CREATE INDEX title_requests_requester_updated ON title_requests(requested_by,updated_at DESC,id);
CREATE INDEX title_requests_work ON title_requests(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX title_requests_external ON title_requests(external_source,external_id) WHERE external_id != '';

CREATE TABLE title_request_formats (
    title_request_id TEXT NOT NULL REFERENCES title_requests(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('ebook','audiobook')),
    state TEXT NOT NULL CHECK (state IN (
        'wanted','searching','awaiting_release','pending_approval','approved',
        'submitting','downloading','verifying','scanning','importing',
        'needs_review','available','denied','canceled','failed'
    )),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    last_searched_at TEXT,
    next_search_at TEXT,
    source_id TEXT REFERENCES library_sources(id) ON DELETE SET NULL,
    legacy_acquisition_request_id TEXT REFERENCES acquisition_requests(id) ON DELETE SET NULL,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(title_request_id,format)
);
CREATE UNIQUE INDEX title_request_formats_legacy_request ON title_request_formats(legacy_acquisition_request_id) WHERE legacy_acquisition_request_id IS NOT NULL;
CREATE INDEX title_request_formats_state ON title_request_formats(state,updated_at,title_request_id,format);
CREATE INDEX title_request_formats_due ON title_request_formats(next_search_at,title_request_id,format)
    WHERE next_search_at IS NOT NULL AND state IN ('wanted','awaiting_release','failed');

CREATE TABLE title_request_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_request_id TEXT NOT NULL REFERENCES title_requests(id) ON DELETE CASCADE,
    format TEXT CHECK (format IS NULL OR format IN ('ebook','audiobook')),
    event_type TEXT NOT NULL CHECK (length(trim(event_type)) BETWEEN 1 AND 100),
    state TEXT CHECK (state IS NULL OR state IN (
        'wanted','searching','awaiting_release','pending_approval','approved',
        'submitting','downloading','verifying','scanning','importing',
        'needs_review','available','denied','canceled','failed'
    )),
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX title_request_events_request ON title_request_events(title_request_id,id);

-- Preserve legacy pairs as one title request. Legacy acquisition tables remain
-- authoritative until the application switches to the new lifecycle.
INSERT INTO title_requests(
    id,library_id,requested_by,work_id,external_source,external_id,title,author,cover_url,created_at,updated_at
)
SELECT
    'legacy-pair:' || p.id,
    p.library_id,
    p.requested_by,
    COALESCE(p.work_id,(SELECT r.work_id FROM acquisition_requests r WHERE r.pair_id=p.id AND r.work_id IS NOT NULL ORDER BY r.created_at,r.id LIMIT 1)),
    COALESCE((SELECT CASE WHEN r.advisory_source!='' AND r.advisory_isbn!='' THEN r.advisory_source ELSE '' END FROM acquisition_requests r WHERE r.pair_id=p.id ORDER BY r.created_at,r.id LIMIT 1),''),
    COALESCE((SELECT CASE WHEN r.advisory_source!='' AND r.advisory_isbn!='' THEN r.advisory_isbn ELSE '' END FROM acquisition_requests r WHERE r.pair_id=p.id ORDER BY r.created_at,r.id LIMIT 1),''),
    COALESCE(NULLIF((SELECT r.advisory_title FROM acquisition_requests r WHERE r.pair_id=p.id AND r.advisory_title!='' ORDER BY r.created_at,r.id LIMIT 1),''),p.query),
    COALESCE((SELECT r.advisory_author FROM acquisition_requests r WHERE r.pair_id=p.id AND r.advisory_author!='' ORDER BY r.created_at,r.id LIMIT 1),''),
    COALESCE((SELECT r.advisory_cover_url FROM acquisition_requests r WHERE r.pair_id=p.id AND r.advisory_cover_url!='' ORDER BY r.created_at,r.id LIMIT 1),''),
    p.created_at,
    p.updated_at
FROM acquisition_pairs p;

INSERT INTO title_requests(
    id,library_id,requested_by,work_id,external_source,external_id,title,author,cover_url,created_at,updated_at
)
SELECT
    'legacy-request:' || r.id,
    r.library_id,
    r.requested_by,
    r.work_id,
    CASE WHEN r.advisory_source!='' AND r.advisory_isbn!='' THEN r.advisory_source ELSE '' END,
    CASE WHEN r.advisory_source!='' AND r.advisory_isbn!='' THEN r.advisory_isbn ELSE '' END,
    COALESCE(NULLIF(r.advisory_title,''),r.query),
    r.advisory_author,
    r.advisory_cover_url,
    r.created_at,
    r.updated_at
FROM acquisition_requests r
WHERE r.pair_id IS NULL;

-- Only classify legacy formats when the accepted proposal or release name is
-- explicit. Ambiguous legacy rows stay solely in the legacy tracker.
WITH classified AS (
    SELECT
        r.*,
        CASE
            WHEN EXISTS(SELECT 1 FROM import_items i WHERE i.group_id=r.proposal_id AND i.representation_kind='epub') THEN 'ebook'
            WHEN EXISTS(SELECT 1 FROM import_items i WHERE i.group_id=r.proposal_id AND i.representation_kind='audiobook') THEN 'audiobook'
            WHEN lower(r.selected_title) LIKE '%audiobook%' OR lower(r.selected_title) LIKE '%.m4b%' OR lower(r.selected_title) LIKE '%.mp3%' OR lower(r.selected_title) LIKE '%.m4a%' OR lower(r.selected_title) LIKE '%.flac%' THEN 'audiobook'
            WHEN lower(r.selected_title) LIKE '%.epub%' THEN 'ebook'
            ELSE NULL
        END AS requested_format
    FROM acquisition_requests r
)
INSERT INTO title_request_formats(
    title_request_id,format,state,legacy_acquisition_request_id,error,created_at,updated_at
)
SELECT
    CASE WHEN pair_id IS NULL THEN 'legacy-request:' || id ELSE 'legacy-pair:' || pair_id END,
    requested_format,
    CASE fulfillment_state
        WHEN 'awaiting_selection' THEN 'wanted'
        WHEN 'submitting' THEN 'submitting'
        WHEN 'downloading' THEN 'downloading'
        WHEN 'scanning' THEN 'scanning'
        WHEN 'needs_review' THEN 'needs_review'
        WHEN 'available' THEN 'available'
        WHEN 'failed' THEN 'failed'
    END,
    id,
    download_error,
    created_at,
    updated_at
FROM classified
WHERE requested_format IS NOT NULL
ON CONFLICT(title_request_id,format) DO NOTHING;

INSERT INTO title_request_events(title_request_id,format,event_type,state,message,created_at)
SELECT title_request_id,format,'legacy_migrated',state,error,updated_at
FROM title_request_formats
WHERE legacy_acquisition_request_id IS NOT NULL;
