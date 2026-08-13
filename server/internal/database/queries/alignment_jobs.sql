-- name: ListAlignmentJobsForWork :many
SELECT j.id,
       COALESCE(j.alignment_id, '') AS alignment_id,
       j.epub_media_id,
       j.audio_media_id,
       j.state,
       j.attempts,
       j.worker_version,
       j.model,
       COALESCE(j.artifact_id, '') AS artifact_id,
       j.error_summary,
       j.created_at,
       j.started_at,
       j.finished_at
FROM alignment_jobs j
JOIN media epub ON epub.id = j.epub_media_id
JOIN representations representation ON representation.id = epub.representation_id
JOIN media audio ON audio.id = j.audio_media_id
JOIN representations audio_representation ON audio_representation.id = audio.representation_id
WHERE representation.work_id = ?
  AND audio_representation.work_id = representation.work_id
ORDER BY j.created_at DESC, j.id DESC
LIMIT ? OFFSET ?;
