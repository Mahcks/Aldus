ALTER TABLE collections ADD COLUMN shared_library_id TEXT REFERENCES libraries(id) ON DELETE CASCADE;
CREATE INDEX collections_shared_library ON collections(shared_library_id) WHERE shared_library_id IS NOT NULL;
