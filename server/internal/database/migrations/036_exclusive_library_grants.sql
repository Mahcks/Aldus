ALTER TABLE library_members ADD COLUMN exclusive INTEGER NOT NULL DEFAULT 0 CHECK(exclusive IN (0,1));

CREATE INDEX library_members_user_exclusive ON library_members(user_id,exclusive,library_id);
