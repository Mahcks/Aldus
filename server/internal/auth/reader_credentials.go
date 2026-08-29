package auth

import (
	"context"
	"crypto/md5" // KOReader sends MD5(password) as x-auth-key by protocol design.
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

type ReaderCredential struct {
	ID        string
	Label     string
	LastUsed  *time.Time
	CreatedAt time.Time
}

type CreatedReaderCredential struct {
	ReaderCredential
	Secret string
}

func (s *Store) CreateReaderCredential(ctx context.Context, actor User, label string) (CreatedReaderCredential, error) {
	label = strings.TrimSpace(label)
	if actor.ID == "" || label == "" || len(label) > 80 {
		return CreatedReaderCredential{}, ErrInvalid
	}
	secret, err := readerSecret()
	if err != nil {
		return CreatedReaderCredential{}, fmt.Errorf("generate reader credential: %w", err)
	}
	secretHash, err := HashPassword(secret)
	if err != nil {
		return CreatedReaderCredential{}, err
	}
	syncKey := md5.Sum([]byte(secret))
	syncHash, err := HashPassword(hex.EncodeToString(syncKey[:]))
	if err != nil {
		return CreatedReaderCredential{}, err
	}
	id, err := randomToken(16)
	if err != nil {
		return CreatedReaderCredential{}, err
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `INSERT INTO reader_credentials(id,user_id,label,secret_hash,sync_key_hash,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM reader_credentials WHERE user_id=?) < 10`, id, actor.ID, label, secretHash, syncHash, formatTime(now), actor.ID)
	if err != nil {
		return CreatedReaderCredential{}, fmt.Errorf("create reader credential: %w", err)
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return CreatedReaderCredential{}, ErrInvalid
	}
	return CreatedReaderCredential{ReaderCredential: ReaderCredential{ID: id, Label: label, CreatedAt: now}, Secret: secret}, nil
}

func readerSecret() (string, error) {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	value := make([]byte, 0, 14)
	buffer := make([]byte, 24)
	for chars := 0; chars < 12; {
		if _, err := rand.Read(buffer); err != nil {
			return "", err
		}
		for _, random := range buffer {
			if random >= byte(256/len(alphabet)*len(alphabet)) {
				continue
			}
			if chars > 0 && chars%4 == 0 {
				value = append(value, '-')
			}
			value = append(value, alphabet[int(random)%len(alphabet)])
			chars++
			if chars == 12 {
				break
			}
		}
	}
	return string(value), nil
}

func (s *Store) ReaderCredentials(ctx context.Context, actor User) ([]ReaderCredential, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,label,last_used_at,created_at FROM reader_credentials WHERE user_id=? ORDER BY created_at DESC,id`, actor.ID)
	if err != nil {
		return nil, fmt.Errorf("list reader credentials: %w", err)
	}
	defer rows.Close()
	var values []ReaderCredential
	for rows.Next() {
		var value ReaderCredential
		var last sql.NullString
		var created string
		if err := rows.Scan(&value.ID, &value.Label, &last, &created); err != nil {
			return nil, err
		}
		value.CreatedAt, _ = parseTime(created)
		if last.Valid {
			parsed, _ := parseTime(last.String)
			value.LastUsed = &parsed
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) DeleteReaderCredential(ctx context.Context, actor User, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM reader_credentials WHERE id=? AND user_id=?`, id, actor.ID)
	if err != nil {
		return fmt.Errorf("delete reader credential: %w", err)
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return ErrInvalid
	}
	return nil
}

func (s *Store) AuthenticateReader(ctx context.Context, username, key string, sync bool) (User, error) {
	if key == "" {
		return User{}, ErrInvalidCredentials
	}
	column := "secret_hash"
	if sync {
		column = "sync_key_hash"
	}
	rows, err := s.db.QueryContext(ctx, `SELECT rc.id,rc.`+column+`,u.id,u.username,u.display_name,u.is_admin,u.created_at,u.updated_at FROM reader_credentials rc JOIN users u ON u.id=rc.user_id WHERE u.username_normalized=? AND u.disabled=0 LIMIT 10`, normalizeUsername(username))
	if err != nil {
		return User{}, fmt.Errorf("find reader credential: %w", err)
	}
	type candidate struct {
		id, hash, created, updated string
		user                       User
	}
	var candidates []candidate
	for rows.Next() {
		var value candidate
		var admin int
		if err := rows.Scan(&value.id, &value.hash, &value.user.ID, &value.user.Username, &value.user.DisplayName, &admin, &value.created, &value.updated); err != nil {
			rows.Close()
			return User{}, err
		}
		value.user.Admin = admin != 0
		candidates = append(candidates, value)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return User{}, err
	}
	rows.Close()
	for _, value := range candidates {
		valid, err := VerifyPassword(value.hash, key)
		if err != nil {
			return User{}, fmt.Errorf("verify reader credential: %w", err)
		}
		if !valid {
			continue
		}
		value.user.CreatedAt, _ = parseTime(value.created)
		value.user.UpdatedAt, _ = parseTime(value.updated)
		_, _ = s.db.ExecContext(ctx, `UPDATE reader_credentials SET last_used_at=? WHERE id=?`, formatTime(time.Now().UTC()), value.id)
		return value.user, nil
	}
	_, _ = VerifyPassword(s.dummyHash, key)
	return User{}, ErrInvalidCredentials
}
