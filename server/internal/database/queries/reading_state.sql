-- name: WorkForAlignment :one
SELECT r.work_id
FROM alignments a
JOIN media m ON m.id = a.epub_media_id
JOIN representations r ON r.id = m.representation_id
WHERE a.id = ?;

-- name: GetProgress :one
SELECT p.work_id, p.alignment_id, p.segment_id, p.offset, p.revision,
       p.updated_at, p.source_device, a.state AS alignment_state,
       a.state = 'ready' AND s.highlightable = 1 AS resolvable
FROM progress p
JOIN alignments a ON a.id = p.alignment_id
JOIN alignment_segments s ON s.alignment_id = p.alignment_id AND s.id = p.segment_id
WHERE p.user_id = ? AND p.work_id = ?;

-- name: GetProgressRevision :one
SELECT revision FROM progress WHERE user_id = ? AND work_id = ?;

-- name: UpsertProgress :exec
INSERT INTO progress (user_id, work_id, alignment_id, segment_id, offset, revision, updated_at, source_device)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, work_id) DO UPDATE SET
    alignment_id = excluded.alignment_id,
    segment_id = excluded.segment_id,
    offset = excluded.offset,
    revision = excluded.revision,
    updated_at = excluded.updated_at,
    source_device = excluded.source_device;

-- name: GetRepresentationState :one
SELECT representation_id, epub_locator, audio_timestamp_ms, playback_speed_milli,
       reader_layout, zoom_milli, reader_theme, line_height_milli, margin_milli, revision, updated_at
FROM representation_state
WHERE user_id = ? AND representation_id = ?;

-- name: GetRepresentationStateRevision :one
SELECT revision FROM representation_state WHERE user_id = ? AND representation_id = ?;

-- name: UpsertRepresentationState :exec
INSERT INTO representation_state (
    user_id, representation_id, epub_locator, audio_timestamp_ms,
    playback_speed_milli, reader_layout, zoom_milli, reader_theme,
    line_height_milli, margin_milli, revision, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, representation_id) DO UPDATE SET
    epub_locator = COALESCE(excluded.epub_locator, representation_state.epub_locator),
    audio_timestamp_ms = COALESCE(excluded.audio_timestamp_ms, representation_state.audio_timestamp_ms),
    playback_speed_milli = COALESCE(excluded.playback_speed_milli, representation_state.playback_speed_milli),
    reader_layout = COALESCE(excluded.reader_layout, representation_state.reader_layout),
    zoom_milli = COALESCE(excluded.zoom_milli, representation_state.zoom_milli),
    reader_theme = COALESCE(excluded.reader_theme, representation_state.reader_theme),
    line_height_milli = COALESCE(excluded.line_height_milli, representation_state.line_height_milli),
    margin_milli = COALESCE(excluded.margin_milli, representation_state.margin_milli),
    revision = excluded.revision,
    updated_at = excluded.updated_at;
