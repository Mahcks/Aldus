CREATE TABLE acquisition_requests (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL REFERENCES users(id),
    query TEXT NOT NULL CHECK (length(trim(query)) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK (status IN ('requested','queued')),
    selected_title TEXT,
    selected_url TEXT,
    selected_source TEXT,
    selected_size INTEGER CHECK (selected_size IS NULL OR selected_size >= 0),
    selected_published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX acquisition_requests_library ON acquisition_requests(library_id,created_at DESC,id);

CREATE TABLE acquisition_results (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES acquisition_requests(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    download_url TEXT NOT NULL,
    source TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    published_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX acquisition_results_request ON acquisition_results(request_id,created_at,id);
