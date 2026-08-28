CREATE TABLE work_subjects (
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    subject TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(subject)) > 0),
    PRIMARY KEY (work_id, subject)
);

CREATE INDEX work_subjects_subject ON work_subjects(subject);

INSERT OR IGNORE INTO work_subjects(work_id, ordinal, subject)
SELECT work_id, 0, trim(subjects)
FROM work_metadata
WHERE subjects <> '' AND instr(subjects, ',') = 0;

INSERT OR IGNORE INTO genre_tag_keywords(id,genre_tag_id,keyword) VALUES
	('classic-literature-3','classic-literature','classics'),
	('children-4','children','juvenile fiction'),
	('historical-fiction-3','historical-fiction','historical novels'),
	('adventure-5','adventure','pirates');
