package catalog

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var (
	ErrNotFound  = errors.New("catalog resource not found")
	ErrForbidden = errors.New("catalog operation forbidden")
	ErrInvalid   = errors.New("invalid catalog input")
	ErrLastOwner = errors.New("cannot remove last owner")
)

type Store struct{ db *sql.DB }

func New(db *sql.DB) *Store { return &Store{db: db} }

type Library struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Membership struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type Work struct {
	ID        string    `json:"id"`
	LibraryID string    `json:"library_id"`
	Title     string    `json:"title"`
	Author    string    `json:"author,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Representation struct {
	ID        string    `json:"id"`
	WorkID    string    `json:"work_id"`
	Kind      string    `json:"kind"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Store) CreateLibrary(ctx context.Context, actor auth.User, name string) (Library, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return Library{}, ErrInvalid
	}
	id, err := randomID()
	if err != nil {
		return Library{}, err
	}
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Library{}, fmt.Errorf("begin library creation: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO libraries(id,name,created_at,updated_at) VALUES(?,?,?,?)`, id, name, stamp, stamp); err != nil {
		return Library{}, fmt.Errorf("create library: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,created_at) VALUES(?,?,'owner',?)`, id, actor.ID, stamp); err != nil {
		return Library{}, fmt.Errorf("create library owner: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Library{}, fmt.Errorf("commit library creation: %w", err)
	}
	return Library{ID: id, Name: name, Role: "owner", CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Libraries(ctx context.Context, actor auth.User, limit, offset int) ([]Library, error) {
	limit, offset = page(limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT l.id,l.name,COALESCE(m.role,''),l.created_at,l.updated_at FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE ? OR m.user_id IS NOT NULL ORDER BY l.created_at,l.id LIMIT ? OFFSET ?`, actor.ID, actor.Admin, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	defer rows.Close()
	var result []Library
	for rows.Next() {
		var v Library
		var c, u string
		if err := rows.Scan(&v.ID, &v.Name, &v.Role, &c, &u); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
		v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
		result = append(result, v)
	}
	return result, rows.Err()
}

func (s *Store) Library(ctx context.Context, actor auth.User, id string) (Library, error) {
	var v Library
	var c, u string
	err := s.db.QueryRowContext(ctx, `SELECT l.id,l.name,COALESCE(m.role,''),l.created_at,l.updated_at FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND (? OR m.user_id IS NOT NULL)`, actor.ID, id, actor.Admin).Scan(&v.ID, &v.Name, &v.Role, &c, &u)
	if errors.Is(err, sql.ErrNoRows) {
		return Library{}, ErrNotFound
	}
	if err != nil {
		return Library{}, fmt.Errorf("get library: %w", err)
	}
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
	v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
	return v, nil
}

func (s *Store) SetMember(ctx context.Context, actor auth.User, libraryID, userID, role string) error {
	if role != "owner" && role != "editor" && role != "reader" {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if ok, err := canManage(ctx, tx, actor, libraryID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	var disabled int
	if err := tx.QueryRowContext(ctx, `SELECT disabled FROM users WHERE id=?`, userID).Scan(&disabled); errors.Is(err, sql.ErrNoRows) || disabled != 0 {
		return ErrInvalid
	} else if err != nil {
		return err
	}
	var currentRole string
	if err := tx.QueryRowContext(ctx, `SELECT role FROM library_members WHERE library_id=? AND user_id=?`, libraryID, userID).Scan(&currentRole); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if currentRole == "owner" && role != "owner" {
		var owners int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_members WHERE library_id=? AND role='owner'`, libraryID).Scan(&owners); err != nil {
			return err
		}
		if owners == 1 {
			return ErrLastOwner
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(library_id,user_id) DO UPDATE SET role=excluded.role`, libraryID, userID, role, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("save membership: %w", err)
	}
	return tx.Commit()
}

func (s *Store) RemoveMember(ctx context.Context, actor auth.User, libraryID, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if ok, err := canManage(ctx, tx, actor, libraryID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	var role string
	if err := tx.QueryRowContext(ctx, `SELECT role FROM library_members WHERE library_id=? AND user_id=?`, libraryID, userID).Scan(&role); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if role == "owner" {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_members WHERE library_id=? AND role='owner'`, libraryID).Scan(&n); err != nil {
			return err
		}
		if n == 1 {
			return ErrLastOwner
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM library_members WHERE library_id=? AND user_id=?`, libraryID, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Members(ctx context.Context, actor auth.User, libraryID string) ([]Membership, error) {
	if ok, err := s.canRead(ctx, actor, libraryID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT u.id,u.username,u.display_name,m.role FROM library_members m JOIN users u ON u.id=m.user_id WHERE m.library_id=? ORDER BY u.username_normalized`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Membership
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) CreateWork(ctx context.Context, actor auth.User, libraryID, title, authorName string) (Work, error) {
	title = strings.TrimSpace(title)
	authorName = strings.TrimSpace(authorName)
	if title == "" || len(title) > 500 || len(authorName) > 500 {
		return Work{}, ErrInvalid
	}
	if ok, err := s.canEdit(ctx, actor, libraryID); err != nil {
		return Work{}, err
	} else if !ok {
		return Work{}, ErrNotFound
	}
	id, err := randomID()
	if err != nil {
		return Work{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO works(id,library_id,title,author,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, libraryID, title, nullString(authorName), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return Work{}, fmt.Errorf("create work: %w", err)
	}
	return Work{ID: id, LibraryID: libraryID, Title: title, Author: authorName, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Works(ctx context.Context, actor auth.User, libraryID string, limit, offset int) ([]Work, error) {
	if ok, err := s.canRead(ctx, actor, libraryID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotFound
	}
	limit, offset = page(limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT id,library_id,title,COALESCE(author,''),created_at,updated_at FROM works WHERE library_id=? ORDER BY created_at,id LIMIT ? OFFSET ?`, libraryID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Work
	for rows.Next() {
		v, err := scanWork(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) Work(ctx context.Context, actor auth.User, id string) (Work, error) {
	var v Work
	var c, u string
	err := s.db.QueryRowContext(ctx, `SELECT w.id,w.library_id,w.title,COALESCE(w.author,''),w.created_at,w.updated_at FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE w.id=? AND (? OR m.user_id IS NOT NULL)`, actor.ID, id, actor.Admin).Scan(&v.ID, &v.LibraryID, &v.Title, &v.Author, &c, &u)
	if errors.Is(err, sql.ErrNoRows) {
		return Work{}, ErrNotFound
	}
	if err != nil {
		return Work{}, err
	}
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
	v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
	return v, nil
}

func (s *Store) CreateRepresentation(ctx context.Context, actor auth.User, workID, kind, label string) (Representation, error) {
	kind = strings.TrimSpace(kind)
	label = strings.TrimSpace(label)
	if kind == "" || label == "" || len(kind) > 100 || len(label) > 300 {
		return Representation{}, ErrInvalid
	}
	var libraryID string
	err := s.db.QueryRowContext(ctx, `SELECT w.library_id FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE w.id=? AND (? OR m.role IN ('owner','editor'))`, actor.ID, workID, actor.Admin).Scan(&libraryID)
	if errors.Is(err, sql.ErrNoRows) {
		return Representation{}, ErrNotFound
	}
	if err != nil {
		return Representation{}, err
	}
	id, err := randomID()
	if err != nil {
		return Representation{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, workID, kind, label, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return Representation{}, err
	}
	return Representation{ID: id, WorkID: workID, Kind: kind, Label: label, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Representations(ctx context.Context, actor auth.User, workID string, limit, offset int) ([]Representation, error) {
	if _, err := s.Work(ctx, actor, workID); err != nil {
		return nil, err
	}
	limit, offset = page(limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT id,work_id,kind,label,created_at,updated_at FROM representations WHERE work_id=? ORDER BY created_at,id LIMIT ? OFFSET ?`, workID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Representation
	for rows.Next() {
		var v Representation
		var c, u string
		if err := rows.Scan(&v.ID, &v.WorkID, &v.Kind, &v.Label, &c, &u); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
		v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) Representation(ctx context.Context, actor auth.User, id string) (Representation, error) {
	var v Representation
	var c, u string
	err := s.db.QueryRowContext(ctx, `SELECT r.id,r.work_id,r.kind,r.label,r.created_at,r.updated_at FROM representations r JOIN works w ON w.id=r.work_id LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE r.id=? AND (? OR m.user_id IS NOT NULL)`, actor.ID, id, actor.Admin).Scan(&v.ID, &v.WorkID, &v.Kind, &v.Label, &c, &u)
	if errors.Is(err, sql.ErrNoRows) {
		return Representation{}, ErrNotFound
	}
	if err != nil {
		return Representation{}, err
	}
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
	v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
	return v, nil
}

func (s *Store) CanAccessAlignment(ctx context.Context, actor auth.User, alignmentID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM alignments a WHERE a.id=? AND (? OR NOT EXISTS (SELECT 1 FROM alignment_inputs ai JOIN media md ON md.id=ai.media_id JOIN representations r ON r.id=md.representation_id JOIN works w ON w.id=r.work_id LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE ai.alignment_id=a.id AND m.user_id IS NULL))`, alignmentID, actor.Admin, actor.ID).Scan(&count)
	return count == 1, err
}

func (s *Store) canRead(ctx context.Context, actor auth.User, libraryID string) (bool, error) {
	if actor.Admin {
		var n int
		err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries WHERE id=?`, libraryID).Scan(&n)
		return n == 1, err
	}
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_members WHERE library_id=? AND user_id=?`, libraryID, actor.ID).Scan(&n)
	return n == 1, err
}
func (s *Store) canEdit(ctx context.Context, actor auth.User, libraryID string) (bool, error) {
	if actor.Admin {
		return s.canRead(ctx, actor, libraryID)
	}
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_members WHERE library_id=? AND user_id=? AND role IN ('owner','editor')`, libraryID, actor.ID).Scan(&n)
	return n == 1, err
}
func canManage(ctx context.Context, tx *sql.Tx, actor auth.User, libraryID string) (bool, error) {
	var n int
	if actor.Admin {
		err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries WHERE id=?`, libraryID).Scan(&n)
		return n == 1, err
	}
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_members WHERE library_id=? AND user_id=? AND role='owner'`, libraryID, actor.ID).Scan(&n)
	return n == 1, err
}
func scanWork(rows *sql.Rows) (Work, error) {
	var v Work
	var c, u string
	err := rows.Scan(&v.ID, &v.LibraryID, &v.Title, &v.Author, &c, &u)
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
	v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
	return v, err
}
func page(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
func nullString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func randomID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
