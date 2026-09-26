// Package ownership fences participating readers without interpreting positions.
package ownership

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var (
	ErrNotFound = errors.New("reading session not found")
	ErrInvalid  = errors.New("invalid reading session")
)

type Proof struct {
	DeviceID string
	Epoch    int64
}

type Session struct {
	WorkID    string
	DeviceID  string
	Label     string
	Platform  string
	Epoch     int64
	UpdatedAt time.Time
}

// Superseded identifies ownership loss separately from a position revision conflict.
type Superseded struct{ Owner *Session }

func (e *Superseded) Error() string { return "reading session continued elsewhere" }

type Claim struct {
	DeviceID      string
	Label         string
	Platform      string
	RequestID     string
	ExpectedEpoch int64
}

type Store struct{ db *sql.DB }

func New(db *sql.DB) *Store { return &Store{db: db} }

const sessionSQL = `
    SELECT o.work_id, o.device_id, d.label, d.platform, o.epoch, o.updated_at
    FROM reading_owners o
    JOIN reading_devices d ON d.user_id = o.user_id AND d.id = o.device_id
    WHERE o.user_id = ? AND o.work_id = ?`

func session(row *sql.Row) (*Session, error) {
	var value Session
	var updated string
	err := row.Scan(&value.WorkID, &value.DeviceID, &value.Label, &value.Platform, &value.Epoch, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read ownership: %w", err)
	}
	value.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	if err != nil {
		return nil, fmt.Errorf("read ownership time: %w", err)
	}
	return &value, nil
}

// LockTx must precede reads in a write transaction. Even a no-row UPDATE takes
// SQLite's reserved write lock, avoiding a deferred read-to-write upgrade race.
func LockTx(ctx context.Context, tx *sql.Tx, userID, workID string) error {
	_, err := tx.ExecContext(ctx, `UPDATE reading_owners SET epoch = epoch WHERE user_id = ? AND work_id = ?`, userID, workID)
	if err != nil {
		return fmt.Errorf("lock reading ownership: %w", err)
	}
	return nil
}

// CheckTx is called inside the position write transaction, before revision checks.
// No proof preserves compatibility with KOReader and older API clients.
func CheckTx(ctx context.Context, tx *sql.Tx, userID, workID string, proof Proof) error {
	if proof.DeviceID == "" {
		if proof.Epoch != 0 {
			return ErrInvalid
		}
		return nil
	}
	if proof.Epoch <= 0 {
		return ErrInvalid
	}
	if err := LockTx(ctx, tx, userID, workID); err != nil {
		return err
	}
	owner, err := session(tx.QueryRowContext(ctx, sessionSQL, userID, workID))
	if err != nil {
		return err
	}
	if owner == nil || owner.DeviceID != proof.DeviceID || owner.Epoch != proof.Epoch {
		return &Superseded{Owner: owner}
	}
	return nil
}

func authorizedTx(ctx context.Context, tx *sql.Tx, actor auth.User, workID string) error {
	var id string
	err := tx.QueryRowContext(ctx, `
  SELECT w.id
  FROM works w
  WHERE w.id = ? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"),
		append([]any{workID}, auth.LibraryAccessArgs(actor)...)...,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("authorize reading session: %w", err)
	}
	return nil
}

func (s *Store) Get(ctx context.Context, actor auth.User, workID string) (*Session, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin reading session lookup: %w", err)
	}
	defer tx.Rollback()

	if err := authorizedTx(ctx, tx, actor, workID); err != nil {
		return nil, err
	}
	return session(tx.QueryRowContext(ctx, sessionSQL, actor.ID, workID))
}

func (s *Store) Claim(ctx context.Context, actor auth.User, workID string, claim Claim) (*Session, error) {
	return s.ClaimWithSnapshot(ctx, actor, workID, claim, nil)
}

// ClaimWithSnapshot captures the saved place before releasing the takeover's
// write lock. A failed capture rolls back the claim as well.
func (s *Store) ClaimWithSnapshot(ctx context.Context, actor auth.User, workID string, claim Claim, capture func(context.Context, *sql.Tx) error) (*Session, error) {
	if strings.TrimSpace(claim.DeviceID) == "" || len(claim.DeviceID) > 128 ||
		strings.TrimSpace(claim.Label) == "" || len(claim.Label) > 100 ||
		strings.TrimSpace(claim.RequestID) == "" || len(claim.RequestID) > 128 ||
		claim.ExpectedEpoch < 0 {
		return nil, ErrInvalid
	}
	switch claim.Platform {
	case "web", "ios", "android", "other":
	default:
		return nil, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin reading takeover: %w", err)
	}
	defer tx.Rollback()

	if err := LockTx(ctx, tx, actor.ID, workID); err != nil {
		return nil, err
	}
	if err := authorizedTx(ctx, tx, actor, workID); err != nil {
		return nil, err
	}
	owner, err := session(tx.QueryRowContext(ctx, sessionSQL, actor.ID, workID))
	if err != nil {
		return nil, err
	}
	if owner != nil {
		var requestID string
		if err := tx.QueryRowContext(ctx, `SELECT claim_id FROM reading_owners WHERE user_id = ? AND work_id = ?`, actor.ID, workID).Scan(&requestID); err != nil {
			return nil, fmt.Errorf("read takeover request: %w", err)
		}
		if requestID == claim.RequestID && owner.DeviceID == claim.DeviceID {
			if capture != nil {
				if err := capture(ctx, tx); err != nil {
					return nil, err
				}
			}
			return owner, nil
		}
	}
	epoch := int64(0)
	if owner != nil {
		epoch = owner.Epoch
	}
	if epoch != claim.ExpectedEpoch {
		return nil, &Superseded{Owner: owner}
	}
	_, err = tx.ExecContext(ctx, `
        INSERT INTO reading_devices (user_id, id, label, platform) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
            label = excluded.label,
            platform = excluded.platform`,
		actor.ID, claim.DeviceID, claim.Label, claim.Platform,
	)
	if err != nil {
		return nil, fmt.Errorf("register reading device: %w", err)
	}
	now := time.Now().UTC()
	_, err = tx.ExecContext(ctx, `
        INSERT INTO reading_owners (user_id, work_id, device_id, epoch, claim_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, work_id) DO UPDATE SET
            device_id = excluded.device_id,
            epoch = excluded.epoch,
            claim_id = excluded.claim_id,
            updated_at = excluded.updated_at`,
		actor.ID, workID, claim.DeviceID, epoch+1, claim.RequestID, now.Format(time.RFC3339Nano))
	if err != nil {
		return nil, fmt.Errorf("claim reading session: %w", err)
	}
	if capture != nil {
		if err := capture(ctx, tx); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit reading takeover: %w", err)
	}
	return &Session{
		WorkID:    workID,
		DeviceID:  claim.DeviceID,
		Label:     claim.Label,
		Platform:  claim.Platform,
		Epoch:     epoch + 1,
		UpdatedAt: now,
	}, nil
}

func (s *Store) Refresh(ctx context.Context, actor auth.User, workID string, proof Proof) (*Session, error) {
	if proof.DeviceID == "" || proof.Epoch <= 0 {
		return nil, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin reading heartbeat: %w", err)
	}
	defer tx.Rollback()

	if err := LockTx(ctx, tx, actor.ID, workID); err != nil {
		return nil, err
	}
	if err := authorizedTx(ctx, tx, actor, workID); err != nil {
		return nil, err
	}
	if err := CheckTx(ctx, tx, actor.ID, workID, proof); err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE reading_owners SET updated_at = ? WHERE user_id = ? AND work_id = ?`, time.Now().UTC().Format(time.RFC3339Nano), actor.ID, workID)
	if err != nil {
		return nil, fmt.Errorf("refresh reading session: %w", err)
	}
	value, err := session(tx.QueryRowContext(ctx, sessionSQL, actor.ID, workID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit reading heartbeat: %w", err)
	}
	return value, nil
}
