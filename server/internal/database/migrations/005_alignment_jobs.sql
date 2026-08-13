CREATE TABLE alignment_jobs (
    id TEXT PRIMARY KEY,
    alignment_id TEXT UNIQUE REFERENCES alignments(id),
    epub_media_id TEXT NOT NULL REFERENCES media(id),
    audio_media_id TEXT NOT NULL REFERENCES media(id),
    state TEXT NOT NULL CHECK (state IN ('pending','processing','ready','failed','stale')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
    worker_version TEXT NOT NULL,
    model TEXT NOT NULL,
    artifact_id TEXT,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (epub_media_id,audio_media_id,worker_version,model)
);
CREATE INDEX alignment_jobs_state_created ON alignment_jobs(state,created_at);

ALTER TABLE alignment_segments ADD COLUMN highlightable INTEGER NOT NULL DEFAULT 1 CHECK (highlightable IN (0,1));
ALTER TABLE alignment_segments ADD COLUMN alignment_status TEXT NOT NULL DEFAULT 'aligned';
ALTER TABLE alignment_segments ADD COLUMN confidence_signals TEXT NOT NULL DEFAULT '{}';
