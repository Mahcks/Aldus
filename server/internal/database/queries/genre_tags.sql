-- name: ListGenreTags :many
SELECT t.id, t.label, t.icon, t.created_at, COALESCE(k.keyword, '') AS keyword
FROM genre_tags t
LEFT JOIN genre_tag_keywords k ON k.genre_tag_id = t.id
ORDER BY t.label COLLATE NOCASE, k.keyword COLLATE NOCASE;

-- name: CreateGenreTag :exec
INSERT INTO genre_tags(id, label, icon) VALUES (?, ?, ?);

-- name: UpdateGenreTag :execrows
UPDATE genre_tags SET label = ?, icon = ? WHERE id = ?;

-- name: DeleteGenreTag :execrows
DELETE FROM genre_tags WHERE id = ?;

-- name: DeleteGenreTagKeywords :exec
DELETE FROM genre_tag_keywords WHERE genre_tag_id = ?;

-- name: CreateGenreTagKeyword :exec
INSERT INTO genre_tag_keywords(id, genre_tag_id, keyword) VALUES (?, ?, ?);
