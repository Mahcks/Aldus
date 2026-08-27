package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrForbidden           = errors.New("authentication operation forbidden")
	ErrLastAdmin           = errors.New("cannot remove last enabled administrator")
	ErrLastOwner           = errors.New("cannot remove the last enabled owner of a library")
	ErrUsernameTaken       = errors.New("username already exists")
	ErrCredentialsRequired = errors.New("account credentials must be changed")
)

func (s *Store) Users(ctx context.Context, actor User, limit, offset int) ([]User, error) {
	if !actor.Admin {
		return nil, ErrForbidden
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,username,display_name,is_admin,disabled,created_at,updated_at,must_change_credentials FROM users WHERE demo_expires_at IS NULL ORDER BY username_normalized LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var admin, disabled, mustChange int
		var c, d string
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &admin, &disabled, &c, &d, &mustChange); err != nil {
			return nil, err
		}
		u.Admin = admin != 0
		u.Disabled = disabled != 0
		u.MustChangeCredentials = mustChange != 0
		u.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
		u.UpdatedAt, _ = time.Parse(time.RFC3339Nano, d)
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCurrentUser(ctx context.Context, actor User, password string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback()
	var admin, disabled int
	var passwordHash string
	var demoExpiresAt sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT is_admin,disabled,password_hash,demo_expires_at FROM users WHERE id=?`, actor.ID).Scan(&admin, &disabled, &passwordHash, &demoExpiresAt); errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthenticated
	} else if err != nil {
		return fmt.Errorf("find account for deletion: %w", err)
	}
	if !demoExpiresAt.Valid {
		valid, err := VerifyPassword(passwordHash, password)
		if err != nil {
			return fmt.Errorf("verify account deletion password: %w", err)
		}
		if !valid {
			return ErrInvalidCredentials
		}
	}
	if admin != 0 && disabled == 0 {
		var enabled int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE is_admin=1 AND disabled=0`).Scan(&enabled); err != nil {
			return fmt.Errorf("count enabled administrators: %w", err)
		}
		if enabled <= 1 {
			return ErrLastAdmin
		}
	}
	if blocked, err := lastEnabledLibraryOwner(ctx, tx, actor.ID); err != nil {
		return err
	} else if blocked {
		return ErrLastOwner
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id=?`, actor.ID)
	if err != nil {
		return fmt.Errorf("delete account: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check account deletion: %w", err)
	}
	if deleted != 1 {
		return ErrUnauthenticated
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit account deletion: %w", err)
	}
	return nil
}

func (s *Store) CreateUser(ctx context.Context, actor User, credentials Credentials, admin bool) (User, string, error) {
	if !actor.Admin {
		return User{}, "", ErrForbidden
	}
	temporaryPassword := credentials.Password
	mustChange := temporaryPassword == ""
	if mustChange {
		var err error
		temporaryPassword, err = randomToken(18)
		if err != nil {
			return User{}, "", fmt.Errorf("generate temporary password: %w", err)
		}
	}
	credentials.Password = temporaryPassword
	username, displayName, err := validateCredentials(credentials)
	if err != nil {
		return User{}, "", err
	}
	passwordHash, err := HashPassword(credentials.Password)
	if err != nil {
		return User{}, "", err
	}
	id, err := randomToken(16)
	if err != nil {
		return User{}, "", err
	}
	now := time.Now().UTC()
	u := User{ID: id, Username: strings.TrimSpace(credentials.Username), DisplayName: displayName, Admin: admin, MustChangeCredentials: mustChange, CreatedAt: now, UpdatedAt: now}
	_, err = s.db.ExecContext(ctx, `INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at,must_change_credentials) VALUES(?,?,?,?,?,?,0,?,?,?)`, id, u.Username, username, displayName, passwordHash, admin, formatTime(now), formatTime(now), mustChange)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return User{}, "", ErrUsernameTaken
		}
		return User{}, "", fmt.Errorf("create user: %w", err)
	}
	if !mustChange {
		temporaryPassword = ""
	}
	return u, temporaryPassword, nil
}

func (s *Store) ResetPassword(ctx context.Context, actor User, userID string) (string, error) {
	if !actor.Admin {
		return "", ErrForbidden
	}
	return s.resetPassword(ctx, `id=? AND demo_expires_at IS NULL`, userID)
}

func (s *Store) ResetAdministratorPasswordFromHost(ctx context.Context, username string) (string, error) {
	return s.resetPassword(ctx, `username_normalized=? AND is_admin=1 AND demo_expires_at IS NULL`, normalizeUsername(username))
}

func (s *Store) resetPassword(ctx context.Context, predicate string, value any) (string, error) {
	temporaryPassword, err := randomToken(18)
	if err != nil {
		return "", fmt.Errorf("generate temporary password: %w", err)
	}
	passwordHash, err := HashPassword(temporaryPassword)
	if err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin password reset: %w", err)
	}
	defer tx.Rollback()
	var userID string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE `+predicate, value).Scan(&userID); errors.Is(err, sql.ErrNoRows) {
		return "", ErrInvalid
	} else if err != nil {
		return "", fmt.Errorf("find password reset account: %w", err)
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash=?,must_change_credentials=1,updated_at=? WHERE id=?`, passwordHash, formatTime(now), userID); err != nil {
		return "", fmt.Errorf("reset password: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, userID); err != nil {
		return "", fmt.Errorf("revoke password reset sessions: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit password reset: %w", err)
	}
	return temporaryPassword, nil
}

func (s *Store) SetDisabled(ctx context.Context, actor User, userID string, disabled bool) error {
	if !actor.Admin {
		return ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var admin, current int
	if err := tx.QueryRowContext(ctx, `SELECT is_admin,disabled FROM users WHERE id=?`, userID).Scan(&admin, &current); errors.Is(err, sql.ErrNoRows) {
		return ErrInvalid
	} else if err != nil {
		return err
	}
	if disabled && admin != 0 && current == 0 {
		var enabled int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE is_admin=1 AND disabled=0`).Scan(&enabled); err != nil {
			return err
		}
		if enabled <= 1 {
			return ErrLastAdmin
		}
	}
	if disabled && current == 0 {
		if blocked, err := lastEnabledLibraryOwner(ctx, tx, userID); err != nil {
			return err
		} else if blocked {
			return ErrLastOwner
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET disabled=?,updated_at=? WHERE id=?`, disabled, formatTime(time.Now().UTC()), userID); err != nil {
		return err
	}
	if disabled {
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func lastEnabledLibraryOwner(ctx context.Context, tx *sql.Tx, userID string) (bool, error) {
	var blocked bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM library_members owned
		WHERE owned.user_id=? AND owned.role='owner' AND NOT EXISTS(
			SELECT 1 FROM library_members other
			JOIN users u ON u.id=other.user_id
			WHERE other.library_id=owned.library_id AND other.role='owner' AND other.user_id<>? AND u.disabled=0
		)
	)`, userID, userID).Scan(&blocked)
	if err != nil {
		return false, fmt.Errorf("check library ownership: %w", err)
	}
	return blocked, nil
}
