-- Keep every saved image. The old default-cover endpoint now edits the ebook
-- cover; explicit ebook choices take precedence over the old browsing choice.
UPDATE works
SET audiobook_cover_id = COALESCE(audiobook_cover_id, selected_cover_id)
WHERE NOT EXISTS (SELECT 1 FROM representations r WHERE r.work_id = works.id AND r.kind = 'epub')
  AND EXISTS (SELECT 1 FROM representations r WHERE r.work_id = works.id AND r.kind IN ('audio', 'audiobook'));

UPDATE works
SET selected_cover_id = ebook_cover_id,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE ebook_cover_id IS NOT NULL AND selected_cover_id IS NOT ebook_cover_id;
