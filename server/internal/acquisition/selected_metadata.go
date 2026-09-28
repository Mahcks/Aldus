package acquisition

import "context"

// Search previews may contain the opening sentence, not a synopsis. Once the
// user chooses a book, prefer its full description but retain a useful fallback.
func (s *Store) enrichSelectedDescription(ctx context.Context, selected *SearchResult) {
	if s.client == nil || selected.OpenLibraryID == "" {
		return
	}
	description, err := s.client.workDescription(ctx, selected.OpenLibraryID)
	if err == nil && description != "" {
		selected.Description = description
	}
}
