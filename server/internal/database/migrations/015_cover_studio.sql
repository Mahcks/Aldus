ALTER TABLE works ADD COLUMN cover_fit TEXT NOT NULL DEFAULT 'cover' CHECK (cover_fit IN ('cover','contain'));
ALTER TABLE works ADD COLUMN cover_focal_x INTEGER NOT NULL DEFAULT 50 CHECK (cover_focal_x BETWEEN 0 AND 100);
ALTER TABLE works ADD COLUMN cover_focal_y INTEGER NOT NULL DEFAULT 50 CHECK (cover_focal_y BETWEEN 0 AND 100);
ALTER TABLE works ADD COLUMN generated_cover_style TEXT NOT NULL DEFAULT 'classic' CHECK (generated_cover_style IN ('classic','minimal','framed'));
ALTER TABLE works ADD COLUMN generated_cover_tone INTEGER NOT NULL DEFAULT -1 CHECK (generated_cover_tone BETWEEN -1 AND 4);
ALTER TABLE works ADD COLUMN generated_cover_layout TEXT NOT NULL DEFAULT 'center' CHECK (generated_cover_layout IN ('top','center','bottom'));
