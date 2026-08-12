CREATE TABLE libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE library_members (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reader')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (library_id, user_id)
);
CREATE INDEX library_members_user_id ON library_members(user_id);

INSERT INTO libraries (id,name,created_at,updated_at)
SELECT 'legacy-library','Legacy Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM works);

CREATE TABLE works_new (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    author TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO works_new (id,library_id,title,created_at,updated_at)
SELECT id,'legacy-library',title,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z' FROM works;

CREATE TABLE representations (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works_new(id),
    kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO representations (id,work_id,kind,label,created_at,updated_at)
SELECT 'legacy-representation-' || id,work_id,kind,
       CASE kind WHEN 'epub' THEN 'EPUB edition' WHEN 'audio' THEN 'Audiobook narration' ELSE kind END,
       created_at,created_at FROM media;

CREATE TABLE media_new (
    id TEXT PRIMARY KEY,
    representation_id TEXT NOT NULL REFERENCES representations(id),
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    created_at TEXT NOT NULL,
    UNIQUE (representation_id, sha256)
);
INSERT INTO media_new (id,representation_id,kind,path,sha256,created_at)
SELECT id,'legacy-representation-' || id,kind,path,sha256,created_at FROM media;

CREATE TABLE koreader_aliases_new (
    document_id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media_new(id)
);
INSERT INTO koreader_aliases_new SELECT * FROM koreader_aliases;

CREATE TABLE alignments_new (
    id TEXT PRIMARY KEY,
    epub_media_id TEXT NOT NULL REFERENCES media_new(id),
    audio_media_id TEXT NOT NULL REFERENCES media_new(id),
    revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','processing','ready','failed','stale')),
    created_at TEXT NOT NULL,
    UNIQUE (epub_media_id,audio_media_id,revision)
);
INSERT INTO alignments_new SELECT * FROM alignments;

CREATE TABLE alignment_segments_new (
    alignment_id TEXT NOT NULL REFERENCES alignments_new(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    text TEXT NOT NULL,
    surrounding_text TEXT NOT NULL DEFAULT '',
    epub_href TEXT NOT NULL,
    epub_locator TEXT NOT NULL,
    koreader_locator TEXT NOT NULL,
    audio_resource TEXT NOT NULL,
    audio_start_ms INTEGER NOT NULL CHECK (audio_start_ms >= 0),
    audio_end_ms INTEGER NOT NULL CHECK (audio_end_ms > audio_start_ms),
    word_timings TEXT,
    PRIMARY KEY (alignment_id,id),
    UNIQUE (alignment_id,ordinal),
    UNIQUE (alignment_id,epub_href,epub_locator),
    UNIQUE (alignment_id,koreader_locator)
);
INSERT INTO alignment_segments_new SELECT * FROM alignment_segments;

CREATE TABLE progress_new (
    alignment_id TEXT PRIMARY KEY REFERENCES alignments_new(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL,
    offset INTEGER NOT NULL CHECK (offset BETWEEN 0 AND 1000000),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    source_device TEXT NOT NULL,
    FOREIGN KEY (alignment_id,segment_id) REFERENCES alignment_segments_new(alignment_id,id)
);
INSERT INTO progress_new SELECT * FROM progress;

DROP TABLE progress;
DROP TABLE alignment_segments;
DROP TABLE koreader_aliases;
DROP TABLE alignments;
DROP TABLE media;
DROP TABLE works;

ALTER TABLE works_new RENAME TO works;
ALTER TABLE media_new RENAME TO media;
ALTER TABLE koreader_aliases_new RENAME TO koreader_aliases;
ALTER TABLE alignments_new RENAME TO alignments;
ALTER TABLE alignment_segments_new RENAME TO alignment_segments;
ALTER TABLE progress_new RENAME TO progress;

CREATE INDEX works_library_id ON works(library_id);
CREATE INDEX representations_work_id ON representations(work_id);
CREATE INDEX media_representation_id ON media(representation_id);

CREATE TABLE alignment_inputs (
    alignment_id TEXT NOT NULL REFERENCES alignments(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id),
    role TEXT NOT NULL CHECK (length(trim(role)) > 0),
    PRIMARY KEY (alignment_id,role),
    UNIQUE (alignment_id,media_id)
);
INSERT INTO alignment_inputs SELECT id,epub_media_id,'epub' FROM alignments;
INSERT INTO alignment_inputs SELECT id,audio_media_id,'audio' FROM alignments;
