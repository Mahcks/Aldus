package acquisition

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/mahcks/aldus/server/internal/auth"
)

// Public release operations use current database authority, never a supplied admin flag.
// Advanced search and approval bypass are separate permissions.
func (s *Store) authorizeRelease(ctx context.Context, actor auth.User, libraryID string, submit bool) (auth.User, error) {
	err := s.db.QueryRowContext(ctx, `SELECT is_admin FROM users WHERE id=? AND disabled=0 AND must_change_credentials=0`, actor.ID).Scan(&actor.Admin)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.User{}, ErrNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("read release authority: %w", err)
	}
	args := append([]any{actor.ID, libraryID}, auth.LibraryAccessArgs(actor)...)
	args = append(args, actor.Admin, submit)
	var allowed bool
	err = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM libraries l
 LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=?
 WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+`
 AND (? OR m.role IN ('owner','editor') OR
 (m.can_request_acquisitions=1 AND m.can_advanced_acquisition_request=1
 AND (NOT ? OR m.can_bypass_acquisition_approval=1))))`, args...).Scan(&allowed)
	if err != nil {
		return auth.User{}, fmt.Errorf("authorize release: %w", err)
	}
	if !allowed {
		return auth.User{}, ErrNotFound
	}
	return actor, nil
}

// Only the guided worker calls this path after policy filtering. The persisted
// searching format must still own this exact download before it can be submitted.
func (s *Store) selectGuidedRelease(ctx context.Context, claim claimedTitleFormat, requestID, resultID string) (Request, error) {
	s.selectMu.Lock()
	defer s.selectMu.Unlock()
	var valid bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM title_request_formats f
 JOIN title_requests t ON t.id=f.title_request_id JOIN acquisition_requests a ON a.id=f.legacy_acquisition_request_id
 WHERE t.id=? AND t.library_id=? AND t.requested_by=? AND f.format=? AND f.state='searching'
 AND f.source_id=? AND a.id=? AND a.library_id=t.library_id AND a.requested_by=t.requested_by AND a.source_id=f.source_id)`,
		claim.requestID, claim.libraryID, claim.requestedBy, claim.format, claim.sourceID, requestID).Scan(&valid)
	if err != nil {
		return Request{}, fmt.Errorf("authorize guided release: %w", err)
	}
	if !valid {
		return Request{}, ErrNotFound
	}
	return s.selectRelease(ctx, auth.User{ID: claim.requestedBy, Admin: true}, claim.libraryID, requestID, resultID)
}
