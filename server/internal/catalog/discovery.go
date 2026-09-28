package catalog

import (
	"context"
	"fmt"

	"github.com/mahcks/aldus/server/internal/auth"
)

// DiscoveryIdentity deliberately omits reading activity and media projections.
// Discover matches this small authorized index before loading the few visible books.
type DiscoveryIdentity struct {
	ID         string
	LibraryID  string
	Title      string
	Author     string
	ProviderID string
}

func (s *Store) DiscoveryIdentities(ctx context.Context, actor auth.User, libraryID string) ([]DiscoveryIdentity, error) {
	args := append(auth.LibraryAccessArgs(actor), libraryID, libraryID)
	rows, err := s.db.QueryContext(ctx, `
        SELECT
            w.id,
            w.library_id,
            w.title,
            COALESCE(w.author, ''),
            COALESCE((
                SELECT provider_work_id
                FROM work_metadata_sources ms
                WHERE ms.work_id = w.id
                  AND ms.field = 'title'
                  AND ms.source = 'open_library'
            ), '')
        FROM works w
        WHERE `+auth.EffectiveLibraryAccessSQL("w.library_id")+`
          AND (? = '' OR w.library_id = ?)
        ORDER BY w.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("read discovery identities: %w", err)
	}
	defer rows.Close()
	var identities []DiscoveryIdentity
	for rows.Next() {
		var identity DiscoveryIdentity
		if err := rows.Scan(&identity.ID, &identity.LibraryID, &identity.Title, &identity.Author, &identity.ProviderID); err != nil {
			return nil, err
		}
		identities = append(identities, identity)
	}
	return identities, rows.Err()
}
