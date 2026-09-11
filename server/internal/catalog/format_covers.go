package catalog

// Explicit choices win. Otherwise expose the newest available file's artwork;
// clients fall back to the library cover if that file has no embedded image.
var formatCoverColumns = `
	COALESCE(
		(SELECT image_url FROM work_covers WHERE id=w.ebook_cover_id AND work_id=w.id),
		(SELECT '/api/media/' || m.id || '/cover'
		 FROM media m JOIN representations r ON r.id=m.representation_id
		 WHERE r.work_id=w.id AND m.kind='epub' AND ` + availableMediaSQL("m") + `
		 ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
		''
	),
	COALESCE(
		(SELECT image_url FROM work_covers WHERE id=w.audiobook_cover_id AND work_id=w.id),
		(SELECT '/api/media/' || m.id || '/cover'
		 FROM media m JOIN representations r ON r.id=m.representation_id
		 WHERE r.work_id=w.id AND m.kind IN ('audio','audiobook') AND ` + availableMediaSQL("m") + `
		 ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
		''
	)`
