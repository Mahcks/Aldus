ALTER TABLE progress RENAME TO legacy_progress;

CREATE TABLE progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    alignment_id TEXT NOT NULL REFERENCES alignments(id),
    segment_id TEXT NOT NULL,
    offset INTEGER NOT NULL CHECK (offset BETWEEN 0 AND 1000000),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    source_device TEXT NOT NULL,
    PRIMARY KEY (user_id,work_id),
    FOREIGN KEY (alignment_id,segment_id) REFERENCES alignment_segments(alignment_id,id)
);

INSERT INTO progress(user_id,work_id,alignment_id,segment_id,offset,revision,updated_at,source_device)
SELECT u.id,w.id,p.alignment_id,p.segment_id,p.offset,p.revision,p.updated_at,p.source_device
FROM legacy_progress p
JOIN alignments a ON a.id=p.alignment_id
JOIN media m ON m.id=a.epub_media_id
JOIN representations r ON r.id=m.representation_id
JOIN works w ON w.id=r.work_id
JOIN users u ON u.id=(SELECT id FROM users ORDER BY created_at,id LIMIT 1);

CREATE TABLE representation_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
    epub_locator TEXT,
    audio_timestamp_ms INTEGER CHECK (audio_timestamp_ms IS NULL OR audio_timestamp_ms >= 0),
    playback_speed_milli INTEGER CHECK (playback_speed_milli IS NULL OR playback_speed_milli BETWEEN 250 AND 4000),
    reader_layout TEXT CHECK (reader_layout IS NULL OR reader_layout IN ('paginated','scrolled')),
    zoom_milli INTEGER CHECK (zoom_milli IS NULL OR zoom_milli BETWEEN 500 AND 3000),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id,representation_id),
    CHECK (epub_locator IS NOT NULL OR audio_timestamp_ms IS NOT NULL OR playback_speed_milli IS NOT NULL OR reader_layout IS NOT NULL OR zoom_milli IS NOT NULL)
);
