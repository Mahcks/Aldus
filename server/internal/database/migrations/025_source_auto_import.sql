ALTER TABLE library_sources ADD COLUMN auto_import INTEGER NOT NULL DEFAULT 0 CHECK (auto_import IN (0,1));
ALTER TABLE source_scans ADD COLUMN auto_imported_count INTEGER NOT NULL DEFAULT 0 CHECK (auto_imported_count >= 0);
