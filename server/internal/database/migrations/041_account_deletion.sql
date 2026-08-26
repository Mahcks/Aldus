PRAGMA legacy_alter_table=ON;

ALTER TABLE library_members RENAME TO library_members_old;
CREATE TABLE library_members (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reader')),
    created_at TEXT NOT NULL,
    can_request_acquisitions INTEGER NOT NULL DEFAULT 0 CHECK (can_request_acquisitions IN (0,1)),
    can_bypass_acquisition_approval INTEGER NOT NULL DEFAULT 0 CHECK (can_bypass_acquisition_approval IN (0,1)),
    can_advanced_acquisition_request INTEGER NOT NULL DEFAULT 0 CHECK (can_advanced_acquisition_request IN (0,1)),
    exclusive INTEGER NOT NULL DEFAULT 0 CHECK(exclusive IN (0,1)),
    PRIMARY KEY (library_id, user_id)
);
INSERT INTO library_members SELECT * FROM library_members_old;
DROP TABLE library_members_old;
CREATE INDEX library_members_user_id ON library_members(user_id);
CREATE INDEX library_members_user_exclusive ON library_members(user_id,exclusive,library_id);

ALTER TABLE acquisition_pairs RENAME TO acquisition_pairs_old;
CREATE TABLE acquisition_pairs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    query TEXT NOT NULL,
    work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO acquisition_pairs SELECT * FROM acquisition_pairs_old;
DROP TABLE acquisition_pairs_old;

ALTER TABLE acquisition_requests RENAME TO acquisition_requests_old;
CREATE TABLE acquisition_requests (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    query TEXT NOT NULL CHECK (length(trim(query)) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK (status IN ('requested','queued')),
    selected_title TEXT,
    selected_url TEXT,
    selected_source TEXT,
    selected_size INTEGER CHECK (selected_size IS NULL OR selected_size >= 0),
    selected_published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_id TEXT REFERENCES library_sources(id),
    download_state TEXT NOT NULL DEFAULT '' CHECK (download_state IN ('','downloading','ready')),
    download_error TEXT NOT NULL DEFAULT '',
    fulfillment_state TEXT NOT NULL DEFAULT 'awaiting_selection' CHECK (fulfillment_state IN ('awaiting_selection','submitting','downloading','scanning','needs_review','available','failed')),
    scan_id TEXT REFERENCES source_scans(id) ON DELETE SET NULL,
    proposal_id TEXT REFERENCES import_groups(id) ON DELETE SET NULL,
    work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    completed_relative_path TEXT NOT NULL DEFAULT '',
    pair_id TEXT REFERENCES acquisition_pairs(id) ON DELETE SET NULL,
    advisory_title TEXT NOT NULL DEFAULT '',
    advisory_author TEXT NOT NULL DEFAULT '',
    advisory_isbn TEXT NOT NULL DEFAULT '',
    advisory_year INTEGER NOT NULL DEFAULT 0,
    advisory_cover_url TEXT NOT NULL DEFAULT '',
    advisory_source TEXT NOT NULL DEFAULT '',
    dismissed_at TEXT NOT NULL DEFAULT '',
    torrent_hash TEXT NOT NULL DEFAULT '',
    download_last_seen_at TEXT NOT NULL DEFAULT '',
    download_progress REAL NOT NULL DEFAULT 0 CHECK (download_progress BETWEEN 0 AND 1),
    download_progress_updated_at TEXT NOT NULL DEFAULT '',
    managed_relative_path TEXT NOT NULL DEFAULT '',
    qbit_state TEXT NOT NULL DEFAULT '',
    advisory_description TEXT NOT NULL DEFAULT '',
    advisory_cover_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO acquisition_requests SELECT * FROM acquisition_requests_old;
DROP TABLE acquisition_requests_old;
CREATE INDEX acquisition_requests_library ON acquisition_requests(library_id,created_at DESC,id);
CREATE INDEX acquisition_requests_fulfillment ON acquisition_requests(fulfillment_state,updated_at);
CREATE INDEX acquisition_requests_pair ON acquisition_requests(pair_id,created_at,id);
CREATE INDEX acquisition_requests_requester_updates ON acquisition_requests(requested_by,dismissed_at,updated_at DESC);

ALTER TABLE title_requests RENAME TO title_requests_old;
CREATE TABLE title_requests (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
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
INSERT INTO title_requests SELECT * FROM title_requests_old;
DROP TABLE title_requests_old;
CREATE INDEX title_requests_library_updated ON title_requests(library_id,updated_at DESC,id);
CREATE INDEX title_requests_requester_updated ON title_requests(requested_by,updated_at DESC,id);
CREATE INDEX title_requests_work ON title_requests(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX title_requests_external ON title_requests(external_source,external_id) WHERE external_id != '';

PRAGMA legacy_alter_table=OFF;
