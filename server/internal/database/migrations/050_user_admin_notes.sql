ALTER TABLE users ADD COLUMN admin_note TEXT NOT NULL DEFAULT '' CHECK (length(admin_note) <= 500);
