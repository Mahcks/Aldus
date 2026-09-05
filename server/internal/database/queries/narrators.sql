-- name: RepresentationNarrators :many
SELECT name FROM representation_narrators WHERE representation_id = ? ORDER BY ordinal;

-- name: DeleteRepresentationNarrators :exec
DELETE FROM representation_narrators WHERE representation_id = ?;

-- name: InsertRepresentationNarrator :exec
INSERT INTO representation_narrators(representation_id,ordinal,name,name_key) VALUES(?,?,?,?);
