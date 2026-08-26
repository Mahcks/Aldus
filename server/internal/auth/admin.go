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
	ErrForbidden     = errors.New("authentication operation forbidden")
	ErrLastAdmin     = errors.New("cannot remove last enabled administrator")
	ErrUsernameTaken = errors.New("username already exists")
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
	rows, err := s.db.QueryContext(ctx, `SELECT id,username,display_name,is_admin,disabled,created_at,updated_at FROM users WHERE demo_expires_at IS NULL ORDER BY username_normalized LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var admin, disabled int
		var c, d string
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &admin, &disabled, &c, &d); err != nil {
			return nil, err
		}
		u.Admin = admin != 0
		u.Disabled = disabled != 0
		u.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
		u.UpdatedAt, _ = time.Parse(time.RFC3339Nano, d)
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCurrentUser(ctx context.Context, actor User) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback()
	var admin, disabled int
	if err := tx.QueryRowContext(ctx, `SELECT is_admin,disabled FROM users WHERE id=?`, actor.ID).Scan(&admin, &disabled); errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthenticated
	} else if err != nil {
		return fmt.Errorf("find account for deletion: %w", err)
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

func (s *Store) CreateUser(ctx context.Context, actor User, credentials Credentials, admin bool) (User, error) {
	if !actor.Admin {
		return User{}, ErrForbidden
	}
	username, displayName, err := validateCredentials(credentials)
	if err != nil {
		return User{}, err
	}
	passwordHash, err := HashPassword(credentials.Password)
	if err != nil {
		return User{}, err
	}
	id, err := randomToken(16)
	if err != nil {
		return User{}, err
	}
	now := time.Now().UTC()
	u := User{ID: id, Username: strings.TrimSpace(credentials.Username), DisplayName: displayName, Admin: admin, CreatedAt: now, UpdatedAt: now}
	_, err = s.db.ExecContext(ctx, `INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)`, id, u.Username, username, displayName, passwordHash, admin, formatTime(now), formatTime(now))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return User{}, ErrUsernameTaken
		}
		return User{}, fmt.Errorf("create user: %w", err)
	}
	return u, nil
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
