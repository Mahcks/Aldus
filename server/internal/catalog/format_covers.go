package catalog

// Explicit choices win. Otherwise expose the newest available file's artwork;
// clients handle missing embedded images with the shared cover fallback.
var ebookCoverColumn = `
	COALESCE(
		(SELECT image_url FROM work_covers WHERE id=w.selected_cover_id AND work_id=w.id),
		(SELECT '/api/media/' || m.id || '/cover'
		 FROM media m JOIN representations r ON r.id=m.representation_id
		 WHERE r.work_id=w.id AND m.kind='epub' AND ` + availableMediaSQL("m") + `
		 ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
		''
	)`

var audiobookCoverColumn = `
	COALESCE(
		(SELECT image_url FROM work_covers WHERE id=w.audiobook_cover_id AND work_id=w.id),
		(SELECT '/api/media/' || m.id || '/cover'
		 FROM media m JOIN representations r ON r.id=m.representation_id
		 WHERE r.work_id=w.id AND m.kind IN ('audio','audiobook') AND ` + availableMediaSQL("m") + `
		 ORDER BY m.created_at DESC,m.id DESC LIMIT 1),
		''
	)`

var formatCoverColumns = ebookCoverColumn + "," + audiobookCoverColumn

// Browsing uses the ebook artwork, or audiobook artwork when no ebook cover exists.
var ebookFirstCoverColumn = "COALESCE(NULLIF(" + ebookCoverColumn + ", ''), NULLIF(" + audiobookCoverColumn + ", ''), '')"

var defaultCoverColumn = `CASE WHEN
 NOT EXISTS (SELECT 1 FROM representations r WHERE r.work_id=w.id AND r.kind='epub')
 AND EXISTS (SELECT 1 FROM representations r WHERE r.work_id=w.id AND r.kind IN ('audio','audiobook'))
 THEN COALESCE(NULLIF(` + audiobookCoverColumn + `, ''), NULLIF(` + ebookCoverColumn + `, ''), '')
 ELSE ` + ebookFirstCoverColumn + ` END`
