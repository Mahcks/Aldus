package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

const (
	defaultMaxEbookBytes     = int64(200 << 20)
	defaultMaxAudiobookBytes = int64(5 << 30)
	maxPolicyBytes           = int64(1 << 40)
)

var policyToken = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type Policy struct {
	LibraryID                  string
	DefaultEbookSourceID       string
	DefaultAudiobookSourceID   string
	MaxEbookBytes              int64
	MaxAudiobookBytes          int64
	AllowedEbookExtensions     []string
	AllowedAudiobookExtensions []string
	PreferredLanguage          string
	AllowAbridged              bool
	MaxActiveRequests          int
	UpdatedAt                  time.Time
}

type PolicyStore struct{ db *sql.DB }

func NewPolicyStore(db *sql.DB) *PolicyStore {
	return &PolicyStore{db: db}
}

func (s *PolicyStore) Get(ctx context.Context, actor auth.User, libraryID string) (Policy, error) {
	if err := s.authorize(ctx, actor, libraryID); err != nil {
		return Policy{}, err
	}
	value := defaultPolicy(libraryID)
	var ebooks, audiobooks, updated string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(default_ebook_source_id,''),COALESCE(default_audiobook_source_id,''),max_ebook_bytes,max_audiobook_bytes,allowed_ebook_extensions,allowed_audiobook_extensions,preferred_language,allow_abridged,max_active_requests,updated_at FROM acquisition_policies WHERE library_id=?`, libraryID).Scan(&value.DefaultEbookSourceID, &value.DefaultAudiobookSourceID, &value.MaxEbookBytes, &value.MaxAudiobookBytes, &ebooks, &audiobooks, &value.PreferredLanguage, &value.AllowAbridged, &value.MaxActiveRequests, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return value, nil
	}
	if err != nil {
		return Policy{}, fmt.Errorf("get acquisition policy: %w", err)
	}
	value.AllowedEbookExtensions = strings.Split(ebooks, ",")
	value.AllowedAudiobookExtensions = strings.Split(audiobooks, ",")
	value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return value, nil
}

func (s *PolicyStore) Update(ctx context.Context, actor auth.User, value Policy) (Policy, error) {
	if err := s.authorize(ctx, actor, value.LibraryID); err != nil {
		return Policy{}, err
	}
	value.DefaultEbookSourceID = strings.TrimSpace(value.DefaultEbookSourceID)
	value.DefaultAudiobookSourceID = strings.TrimSpace(value.DefaultAudiobookSourceID)
	value.PreferredLanguage = strings.ToLower(strings.TrimSpace(value.PreferredLanguage))
	value.AllowedEbookExtensions = normalizeExtensions(value.AllowedEbookExtensions)
	value.AllowedAudiobookExtensions = normalizeExtensions(value.AllowedAudiobookExtensions)
	if value.MaxEbookBytes < 1024 || value.MaxEbookBytes > maxPolicyBytes || value.MaxAudiobookBytes < 1024 || value.MaxAudiobookBytes > maxPolicyBytes || value.MaxActiveRequests < 1 || value.MaxActiveRequests > 100 || len(value.PreferredLanguage) > 35 || !policyToken.MatchString(value.PreferredLanguage) || !validExtensions(value.AllowedEbookExtensions) || !validExtensions(value.AllowedAudiobookExtensions) {
		return Policy{}, ErrInvalid
	}
	for _, sourceID := range []string{value.DefaultEbookSourceID, value.DefaultAudiobookSourceID} {
		if sourceID == "" {
			continue
		}
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM library_sources WHERE id=? AND library_id=? AND enabled=1 AND deleted_at IS NULL)`, sourceID, value.LibraryID).Scan(&exists); err != nil {
			return Policy{}, fmt.Errorf("validate acquisition policy source: %w", err)
		}
		if !exists {
			return Policy{}, ErrInvalid
		}
	}
	value.UpdatedAt = time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `INSERT INTO acquisition_policies(library_id,default_ebook_source_id,default_audiobook_source_id,max_ebook_bytes,max_audiobook_bytes,allowed_ebook_extensions,allowed_audiobook_extensions,preferred_language,allow_abridged,max_active_requests,updated_at) VALUES(?,NULLIF(?,''),NULLIF(?,''),?,?,?,?,?,?,?,?) ON CONFLICT(library_id) DO UPDATE SET default_ebook_source_id=excluded.default_ebook_source_id,default_audiobook_source_id=excluded.default_audiobook_source_id,max_ebook_bytes=excluded.max_ebook_bytes,max_audiobook_bytes=excluded.max_audiobook_bytes,allowed_ebook_extensions=excluded.allowed_ebook_extensions,allowed_audiobook_extensions=excluded.allowed_audiobook_extensions,preferred_language=excluded.preferred_language,allow_abridged=excluded.allow_abridged,max_active_requests=excluded.max_active_requests,updated_at=excluded.updated_at`, value.LibraryID, value.DefaultEbookSourceID, value.DefaultAudiobookSourceID, value.MaxEbookBytes, value.MaxAudiobookBytes, strings.Join(value.AllowedEbookExtensions, ","), strings.Join(value.AllowedAudiobookExtensions, ","), value.PreferredLanguage, value.AllowAbridged, value.MaxActiveRequests, value.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return Policy{}, fmt.Errorf("save acquisition policy: %w", err)
	}
	return value, nil
}

func (s *PolicyStore) authorize(ctx context.Context, actor auth.User, libraryID string) error {
	var allowed bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND (? OR m.role IN ('owner','editor')))`, actor.ID, libraryID, actor.Admin).Scan(&allowed)
	if err != nil {
		return fmt.Errorf("authorize acquisition policy: %w", err)
	}
	if !allowed {
		return ErrForbidden
	}
	return nil
}

func defaultPolicy(libraryID string) Policy {
	return Policy{LibraryID: libraryID, MaxEbookBytes: defaultMaxEbookBytes, MaxAudiobookBytes: defaultMaxAudiobookBytes, AllowedEbookExtensions: []string{"epub"}, AllowedAudiobookExtensions: []string{"m4b", "mp3"}, PreferredLanguage: "en", MaxActiveRequests: 5}
}

func normalizeExtensions(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), ".")
		if value != "" && !slices.Contains(out, value) {
			out = append(out, value)
		}
	}
	slices.Sort(out)
	return out
}

func validExtensions(values []string) bool {
	if len(values) == 0 || len(values) > 16 {
		return false
	}
	for _, value := range values {
		if len(value) > 16 || !policyToken.MatchString(value) {
			return false
		}
	}
	return true
}
