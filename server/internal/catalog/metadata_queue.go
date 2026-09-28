package catalog

// metadataMissingSQL uses the same work alias as BrowseWorks. Narrator gaps are
// recording-specific: one credited recording does not hide another missing credit.
var metadataMissingSQL = `
    SELECT value FROM (
        SELECT 'author' AS value WHERE trim(COALESCE(w.author, '')) = ''
        UNION ALL
        SELECT 'description' WHERE NOT EXISTS (
            SELECT 1 FROM work_metadata md
            WHERE md.work_id = w.id AND trim(COALESCE(md.description, '')) != ''
        )
        UNION ALL
        SELECT 'cover' WHERE NOT EXISTS (
            SELECT 1 FROM work_covers wc
            WHERE wc.work_id = w.id
                AND wc.id IN (w.selected_cover_id, w.audiobook_cover_id)
                AND trim(wc.image_url) != ''
        )
        UNION ALL
        SELECT 'narrator' WHERE EXISTS (
            SELECT 1
            FROM representations nr
            JOIN media nm ON nm.representation_id = nr.id
            WHERE nr.work_id = w.id
                AND nr.kind IN ('audio', 'audiobook')
                AND nm.kind IN ('audio', 'audiobook')
                AND ` + availableMediaSQL("nm") + `
                AND NOT EXISTS (
                    SELECT 1 FROM representation_narrators rn
                    WHERE rn.representation_id = nr.id
                )
        )
    )`
