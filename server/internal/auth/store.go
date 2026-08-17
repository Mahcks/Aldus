package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
)

var (
	ErrSetupClosed        = errors.New("setup closed")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthenticated    = errors.New("unauthenticated")
	ErrInvalid            = errors.New("invalid authentication input")
)

const CookieName = "aldus_session"

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,63}$`)

type Options struct {
	SessionTTL    time.Duration
	SecureCookies bool
}

type User struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Admin       bool      `json:"admin"`
	Disabled    bool      `json:"disabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Session struct {
	Token     string    `json:"token,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
	User      User      `json:"user"`
}

type Credentials struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name,omitempty"`
}

type Store struct {
	db        *sql.DB
	queries   *dbsql.Queries
	options   Options
	dummyHash string
}

func New(db *sql.DB, options Options) (*Store, error) {
	if options.SessionTTL <= 0 {
		options.SessionTTL = 30 * 24 * time.Hour
	}
	dummyHash, err := HashPassword("not-a-real-password")
	if err != nil {
		return nil, fmt.Errorf("prepare credential check: %w", err)
	}
	return &Store{db: db, queries: dbsql.New(db), options: options, dummyHash: dummyHash}, nil
}

func (s *Store) SetupAvailable(ctx context.Context) (bool, error) {
	count, err := s.queries.CountUsers(ctx)
	if err != nil {
		return false, fmt.Errorf("count users: %w", err)
	}
	return count == 0, nil
}

func (s *Store) Setup(ctx context.Context, credentials Credentials) (Session, error) {
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
		return Session{}, fmt.Errorf("begin setup: %w", err)
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	userID, err := randomToken(16)
	if err != nil {
		return Session{}, fmt.Errorf("generate user ID: %w", err)
	}
	user := User{ID: userID, Username: strings.TrimSpace(credentials.Username), DisplayName: displayName, Admin: true, CreatedAt: now, UpdatedAt: now}
	result, err := tx.ExecContext(ctx, `INSERT INTO users (id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
		SELECT ?,?,?,?,?,1,0,?,? WHERE NOT EXISTS (SELECT 1 FROM users)`,
		user.ID, user.Username, username, user.DisplayName, passwordHash, formatTime(now), formatTime(now))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return Session{}, ErrSetupClosed
		}
		return Session{}, fmt.Errorf("create setup user: %w", err)
	}
	created, err := result.RowsAffected()
	if err != nil {
		return Session{}, fmt.Errorf("check setup user: %w", err)
	}
	if created != 1 {
		return Session{}, ErrSetupClosed
	}
	session, err := createSession(ctx, tx, user, now, s.options.SessionTTL)
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, fmt.Errorf("commit setup: %w", err)
	}
	return session, nil
}

func (s *Store) Login(ctx context.Context, credentials Credentials) (Session, error) {
	username := normalizeUsername(credentials.Username)
	var user User
	var passwordHash, createdAt, updatedAt string
	var admin, disabled int
	err := s.db.QueryRowContext(ctx, `SELECT id,username,display_name,password_hash,is_admin,disabled,created_at,updated_at FROM users WHERE username_normalized = ?`, username).
		Scan(&user.ID, &user.Username, &user.DisplayName, &passwordHash, &admin, &disabled, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		_, _ = VerifyPassword(s.dummyHash, credentials.Password)
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, fmt.Errorf("find login user: %w", err)
	}
	valid, err := VerifyPassword(passwordHash, credentials.Password)
	if err != nil {
		return Session{}, fmt.Errorf("verify stored password: %w", err)
	}
	if !valid || disabled != 0 {
		return Session{}, ErrInvalidCredentials
	}
	user.Admin, user.Disabled = admin != 0, disabled != 0
	if user.CreatedAt, err = parseTime(createdAt); err != nil {
		return Session{}, err
	}
	if user.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return Session{}, err
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, formatTime(now)); err != nil {
		return Session{}, fmt.Errorf("delete expired sessions: %w", err)
	}
	return createSession(ctx, s.db, user, now, s.options.SessionTTL)
}

type execer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func createSession(ctx context.Context, db execer, user User, now time.Time, ttl time.Duration) (Session, error) {
	token, err := randomToken(32)
	if err != nil {
		return Session{}, fmt.Errorf("generate session token: %w", err)
	}
	hash := sha256.Sum256([]byte(token))
	expires := now.Add(ttl)
	if _, err := db.ExecContext(ctx, `INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)`, hash[:], user.ID, formatTime(expires), formatTime(now), formatTime(now)); err != nil {
		return Session{}, fmt.Errorf("create session: %w", err)
	}
	return Session{Token: token, ExpiresAt: expires, User: user}, nil
}

func (s *Store) Authenticate(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthenticated
	}
	hash := sha256.Sum256([]byte(token))
	var user User
	var createdAt, updatedAt string
	var admin, disabled int
	now := time.Now().UTC()
	err := s.db.QueryRowContext(ctx, `SELECT u.id,u.username,u.display_name,u.is_admin,u.disabled,u.created_at,u.updated_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`, hash[:], formatTime(now)).
		Scan(&user.ID, &user.Username, &user.DisplayName, &admin, &disabled, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthenticated
	}
	if err != nil {
		return User{}, fmt.Errorf("authenticate session: %w", err)
	}
	user.Admin, user.Disabled = admin != 0, disabled != 0
	if user.CreatedAt, err = parseTime(createdAt); err != nil {
		return User{}, err
	}
	if user.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return User{}, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE sessions SET last_seen_at=? WHERE token_hash=?`, formatTime(now), hash[:]); err != nil {
		return User{}, fmt.Errorf("touch session: %w", err)
	}
	return user, nil
}

func (s *Store) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	hash := sha256.Sum256([]byte(token))
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=?`, hash[:]); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func validateCredentials(credentials Credentials) (string, string, error) {
	username := normalizeUsername(credentials.Username)
	if !usernamePattern.MatchString(username) || len(credentials.Password) < 12 || len(credentials.Password) > 1024 {
		return "", "", ErrInvalid
	}
	displayName := strings.TrimSpace(credentials.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(credentials.Username)
	}
	if len(displayName) > 100 {
		return "", "", ErrInvalid
	}
	return username, displayName, nil
}

func normalizeUsername(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

func randomToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func formatTime(value time.Time) string { return value.Format(time.RFC3339Nano) }

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse authentication time: %w", err)
	}
	return parsed, nil
}
