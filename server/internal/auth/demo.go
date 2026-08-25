package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

func (s *Store) CreateDemoSession(ctx context.Context) (Session, error) {
	if !s.DemoAvailable() {
		return Session{}, ErrDemoDisabled
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, fmt.Errorf("begin demo session: %w", err)
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	if err := cleanupExpiredDemoUsers(ctx, tx, now); err != nil {
		return Session{}, err
	}
	var libraryExists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries WHERE id=?`, s.options.DemoLibraryID).Scan(&libraryExists); err != nil {
		return Session{}, fmt.Errorf("find demo library: %w", err)
	}
	if libraryExists != 1 {
		return Session{}, ErrDemoDisabled
	}
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE demo_expires_at>?`, formatTime(now)).Scan(&active); err != nil {
		return Session{}, fmt.Errorf("count demo users: %w", err)
	}
	if active >= s.options.DemoCapacity {
		return Session{}, ErrDemoCapacity
	}
	userID, err := randomToken(16)
	if err != nil {
		return Session{}, fmt.Errorf("generate demo user ID: %w", err)
	}
	suffix, err := randomToken(6)
	if err != nil {
		return Session{}, fmt.Errorf("generate demo username: %w", err)
	}
	password, err := randomToken(32)
	if err != nil {
		return Session{}, fmt.Errorf("generate demo password: %w", err)
	}
	passwordHash, err := HashPassword(password)
	if err != nil {
		return Session{}, err
	}
	expires := now.Add(s.options.DemoTTL)
	username := "guest-" + strings.ToLower(suffix)
	user := User{
		ID: userID, Username: username, DisplayName: "Guest " + strings.ToUpper(suffix[len(suffix)-4:]),
		CreatedAt: now, UpdatedAt: now, DemoExpiresAt: &expires,
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at,demo_expires_at) VALUES(?,?,?,?,?,0,0,?,?,?)`, user.ID, user.Username, user.Username, user.DisplayName, passwordHash, formatTime(now), formatTime(now), formatTime(expires)); err != nil {
		return Session{}, fmt.Errorf("create demo user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,exclusive,can_request_acquisitions,can_bypass_acquisition_approval,can_advanced_acquisition_request,created_at) VALUES(?,?,'reader',0,0,0,0,?)`, s.options.DemoLibraryID, user.ID, formatTime(now)); err != nil {
		return Session{}, fmt.Errorf("grant demo library: %w", err)
	}
	session, err := createSession(ctx, tx, user, now, s.options.DemoTTL)
	if err != nil {
		return Session{}, err
	}
	pairingCode, err := createDemoPairingCode(ctx, tx, user.ID, now)
	if err != nil {
		return Session{}, err
	}
	session.DemoPairingCode = pairingCode
	session.DemoPairingExpiresAt = now.Add(10 * time.Minute)
	session.DemoPassword = password
	if err := tx.Commit(); err != nil {
		return Session{}, fmt.Errorf("commit demo session: %w", err)
	}
	return session, nil
}

func (s *Store) RedeemDemoPairingCode(ctx context.Context, code string) (Session, error) {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	if len(normalized) != 8 {
		return Session{}, ErrInvalidPairingCode
	}
	hash := sha256.Sum256([]byte(normalized))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, fmt.Errorf("begin demo pairing: %w", err)
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	var userID string
	if err := tx.QueryRowContext(ctx, `DELETE FROM demo_pairing_codes WHERE code_hash=? AND expires_at>? RETURNING user_id`, hash[:], formatTime(now)).Scan(&userID); errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrInvalidPairingCode
	} else if err != nil {
		return Session{}, fmt.Errorf("consume demo pairing code: %w", err)
	}
	var user User
	var createdAt, updatedAt, demoExpiresAt string
	var admin, disabled int
	if err := tx.QueryRowContext(ctx, `SELECT id,username,display_name,is_admin,disabled,created_at,updated_at,demo_expires_at FROM users WHERE id=? AND demo_expires_at>?`, userID, formatTime(now)).Scan(&user.ID, &user.Username, &user.DisplayName, &admin, &disabled, &createdAt, &updatedAt, &demoExpiresAt); errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrInvalidPairingCode
	} else if err != nil {
		return Session{}, fmt.Errorf("find paired demo user: %w", err)
	}
	user.Admin, user.Disabled = admin != 0, disabled != 0
	if user.Disabled {
		return Session{}, ErrInvalidPairingCode
	}
	if user.CreatedAt, err = parseTime(createdAt); err != nil {
		return Session{}, err
	}
	if user.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return Session{}, err
	}
	expires, err := parseTime(demoExpiresAt)
	if err != nil {
		return Session{}, err
	}
	user.DemoExpiresAt = &expires
	session, err := createSession(ctx, tx, user, now, expires.Sub(now))
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, fmt.Errorf("commit demo pairing: %w", err)
	}
	return session, nil
}

func createDemoPairingCode(ctx context.Context, tx *sql.Tx, userID string, now time.Time) (string, error) {
	const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	code := make([]byte, 8)
	for i := range code {
		value, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", fmt.Errorf("generate demo pairing code: %w", err)
		}
		code[i] = alphabet[value.Int64()]
	}
	hash := sha256.Sum256(code)
	if _, err := tx.ExecContext(ctx, `INSERT INTO demo_pairing_codes(code_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)`, hash[:], userID, formatTime(now.Add(10*time.Minute)), formatTime(now)); err != nil {
		return "", fmt.Errorf("save demo pairing code: %w", err)
	}
	return string(code[:4]) + "-" + string(code[4:]), nil
}

func (s *Store) CleanupExpiredDemoUsers(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin demo cleanup: %w", err)
	}
	defer tx.Rollback()
	if err := cleanupExpiredDemoUsers(ctx, tx, time.Now().UTC()); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit demo cleanup: %w", err)
	}
	return nil
}

func cleanupExpiredDemoUsers(ctx context.Context, tx *sql.Tx, now time.Time) error {
	cutoff := formatTime(now)
	if _, err := tx.ExecContext(ctx, `DELETE FROM library_members WHERE user_id IN (SELECT id FROM users WHERE demo_expires_at IS NOT NULL AND demo_expires_at<=?)`, cutoff); err != nil {
		return fmt.Errorf("remove expired demo memberships: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM users WHERE demo_expires_at IS NOT NULL AND demo_expires_at<=?`, cutoff); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("remove expired demo users: %w", err)
	}
	return nil
}
