ALTER TABLE works ADD COLUMN series_name TEXT NOT NULL DEFAULT '';
ALTER TABLE works ADD COLUMN series_key TEXT NOT NULL DEFAULT '';
ALTER TABLE works ADD COLUMN series_order INTEGER CHECK(series_order BETWEEN 0 AND 999999999);
CREATE INDEX works_series ON works(library_id,series_key,series_order);
CREATE TABLE representation_narrators (
 representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 19),
 name TEXT NOT NULL,
 name_key TEXT NOT NULL,
 PRIMARY KEY(representation_id,ordinal),
 UNIQUE(representation_id,name_key)
);
CREATE INDEX narrator_names ON representation_narrators(name_key,representation_id);
