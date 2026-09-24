ALTER TABLE users ADD COLUMN primary_library_id TEXT REFERENCES libraries(id) ON DELETE SET NULL;
