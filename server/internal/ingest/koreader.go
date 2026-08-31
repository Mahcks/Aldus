package ingest

import (
	"context"
	"fmt"

	"github.com/mahcks/aldus/server/internal/position"
)

func (s *Store) BackfillKOReaderAliases(ctx context.Context) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT m.id FROM media m WHERE m.kind='epub' AND NOT EXISTS(SELECT 1 FROM koreader_aliases k WHERE k.media_id=m.id) ORDER BY m.created_at,m.id`)
	if err != nil {
		return 0, fmt.Errorf("list EPUB identities: %w", err)
	}
	var mediaIDs []string
	for rows.Next() {
		var mediaID string
		if err := rows.Scan(&mediaID); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan EPUB identity: %w", err)
		}
		mediaIDs = append(mediaIDs, mediaID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("read EPUB identities: %w", err)
	}
	if err := rows.Close(); err != nil {
		return 0, fmt.Errorf("close EPUB identities: %w", err)
	}

	updated := 0
	for _, mediaID := range mediaIDs {
		file, err := s.resolver.OpenMedia(ctx, mediaID, false)
		if err != nil {
			return updated, fmt.Errorf("open EPUB %s for KOReader identity: %w", mediaID, err)
		}
		documentID, hashErr := position.KOReaderPartialMD5(file)
		closeErr := file.Close()
		if hashErr != nil {
			return updated, fmt.Errorf("identify EPUB %s for KOReader: %w", mediaID, hashErr)
		}
		if closeErr != nil {
			return updated, fmt.Errorf("close EPUB %s after KOReader identity: %w", mediaID, closeErr)
		}
		if _, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO koreader_aliases(document_id,media_id) VALUES(?,?)`, documentID, mediaID); err != nil {
			return updated, fmt.Errorf("record EPUB %s KOReader identity: %w", mediaID, err)
		}
		updated++
	}
	return updated, nil
}
