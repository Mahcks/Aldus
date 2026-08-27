ALTER TABLE representation_state RENAME TO legacy_representation_state;

CREATE TABLE representation_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
    epub_locator TEXT,
    audio_timestamp_ms INTEGER CHECK (audio_timestamp_ms IS NULL OR audio_timestamp_ms >= 0),
    playback_speed_milli INTEGER CHECK (playback_speed_milli IS NULL OR playback_speed_milli BETWEEN 250 AND 4000),
    reader_layout TEXT CHECK (reader_layout IS NULL OR reader_layout IN ('paginated','scrolled')),
    zoom_milli INTEGER CHECK (zoom_milli IS NULL OR zoom_milli BETWEEN 500 AND 3000),
    reader_theme TEXT CHECK (reader_theme IS NULL OR reader_theme IN ('paper','sepia','night')),
    line_height_milli INTEGER CHECK (line_height_milli IS NULL OR line_height_milli BETWEEN 1200 AND 2200),
    margin_milli INTEGER CHECK (margin_milli IS NULL OR margin_milli BETWEEN 0 AND 4000),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id,representation_id),
    CHECK (epub_locator IS NOT NULL OR audio_timestamp_ms IS NOT NULL OR playback_speed_milli IS NOT NULL OR reader_layout IS NOT NULL OR zoom_milli IS NOT NULL OR reader_theme IS NOT NULL OR line_height_milli IS NOT NULL OR margin_milli IS NOT NULL)
);

INSERT INTO representation_state (
    user_id,representation_id,epub_locator,audio_timestamp_ms,playback_speed_milli,
    reader_layout,zoom_milli,reader_theme,line_height_milli,margin_milli,revision,updated_at
)
SELECT user_id,representation_id,epub_locator,audio_timestamp_ms,playback_speed_milli,
       reader_layout,zoom_milli,reader_theme,line_height_milli,margin_milli,revision,updated_at
FROM legacy_representation_state;

DROP TABLE legacy_representation_state;
