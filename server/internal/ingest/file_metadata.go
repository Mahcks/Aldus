package ingest

import (
	"context"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

// FileMetadata reads existing media without rewriting it or creating an import.
// Share the chapter-probe limit so simultaneous requests cannot spawn unbounded
// ffprobe processes. The API additionally requires catalog edit access.
func (s *Store) FileMetadata(ctx context.Context, actor auth.User, id string) (source.FileMetadata, error) {
	file, media, err := s.Open(ctx, actor, id)
	if err != nil {
		return source.FileMetadata{}, err
	}
	defer file.Close()
	select {
	case s.probes <- struct{}{}:
		defer func() { <-s.probes }()
	case <-ctx.Done():
		return source.FileMetadata{}, ctx.Err()
	}
	return source.InspectFileMetadata(ctx, file.Name(), media.Kind, s.maxBytes)
}
