package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Store) ClaimAccount(ctx context.Context, actor User, credentials Credentials) (Session, error) {
	username, displayName, err := validateCredentials(credentials)
	if err != nil {
		return Session{}, err
	}
	passwordHash, err := HashPassword(credentials.Password)
	if err != nil {
		return Session{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, fmt.Errorf("begin account claim: %w", err)
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE users SET username=?,username_normalized=?,display_name=?,password_hash=?,must_change_credentials=0,updated_at=? WHERE id=? AND must_change_credentials=1 AND demo_expires_at IS NULL`, strings.TrimSpace(credentials.Username), username, displayName, passwordHash, formatTime(now), actor.ID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return Session{}, ErrUsernameTaken
		}
		return Session{}, fmt.Errorf("claim account: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return Session{}, ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, actor.ID); err != nil {
		return Session{}, fmt.Errorf("revoke temporary sessions: %w", err)
	}
	actor.Username = strings.TrimSpace(credentials.Username)
	actor.DisplayName = displayName
	actor.MustChangeCredentials = false
	actor.UpdatedAt = now
	session, err := createSession(ctx, tx, actor, now, s.options.SessionTTL)
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, fmt.Errorf("commit account claim: %w", err)
	}
	return session, nil
}

func (s *Store) ChangePassword(ctx context.Context, actor User, currentPassword, newPassword string) (Session, error) {
	if actor.MustChangeCredentials {
		return Session{}, ErrCredentialsRequired
	}
	if _, _, err := validateCredentials(Credentials{Username: actor.Username, DisplayName: actor.DisplayName, Password: newPassword}); err != nil {
		return Session{}, err
	}
	newHash, err := HashPassword(newPassword)
	if err != nil {
		return Session{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, fmt.Errorf("begin password change: %w", err)
	}
	defer tx.Rollback()
	var currentHash string
	if err := tx.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id=? AND disabled=0 AND demo_expires_at IS NULL`, actor.ID).Scan(&currentHash); errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrInvalid
	} else if err != nil {
		return Session{}, fmt.Errorf("find password change account: %w", err)
	}
	valid, err := VerifyPassword(currentHash, currentPassword)
	if err != nil {
		return Session{}, fmt.Errorf("verify current password: %w", err)
	}
	if !valid {
		return Session{}, ErrInvalidCredentials
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash=?,updated_at=? WHERE id=?`, newHash, formatTime(now), actor.ID); err != nil {
		return Session{}, fmt.Errorf("change password: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, actor.ID); err != nil {
		return Session{}, fmt.Errorf("revoke password change sessions: %w", err)
	}
	actor.UpdatedAt = now
	session, err := createSession(ctx, tx, actor, now, s.options.SessionTTL)
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, fmt.Errorf("commit password change: %w", err)
	}
	return session, nil
}

func (s *Store) UpdateDisplayName(ctx context.Context, actor User, displayName string) (User, error) {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || len(displayName) > 100 || actor.MustChangeCredentials {
		return User{}, ErrInvalid
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `UPDATE users SET display_name=?,updated_at=? WHERE id=? AND disabled=0`, displayName, formatTime(now), actor.ID)
	if err != nil {
		return User{}, fmt.Errorf("update display name: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return User{}, ErrInvalid
	}
	actor.DisplayName = displayName
	actor.UpdatedAt = now
	return actor, nil
}

func (s *Store) RevokeAllSessions(ctx context.Context, actor User) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, actor.ID); err != nil {
		return fmt.Errorf("revoke all sessions: %w", err)
	}
	return nil
}
