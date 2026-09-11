-- Keep the library cover and each format's chosen artwork independent.
ALTER TABLE works ADD COLUMN ebook_cover_id TEXT REFERENCES work_covers(id) ON DELETE SET NULL;
ALTER TABLE works ADD COLUMN audiobook_cover_id TEXT REFERENCES work_covers(id) ON DELETE SET NULL;
