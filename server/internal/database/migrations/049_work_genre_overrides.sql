CREATE TABLE work_genre_overrides (
    work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE
);

CREATE TABLE work_genre_tags (
    work_id TEXT NOT NULL REFERENCES work_genre_overrides(work_id) ON DELETE CASCADE,
    genre_tag_id TEXT NOT NULL REFERENCES genre_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (work_id, genre_tag_id)
);

CREATE INDEX work_genre_tags_tag ON work_genre_tags(genre_tag_id);
