package collection

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
	ErrNotFound = errors.New("collection not found")
	ErrInvalid  = errors.New("invalid collection input")
)

type Collection struct {
	ID          string
	Title       string
	Description string
	WorkCount   int
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Works       []Work
}

type Work struct {
	ID       string
	Title    string
	Author   string
	CoverURL string
	Position int
}

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, actor auth.User) ([]Collection, error) {
	args := append(auth.LibraryAccessArgs(actor), actor.ID)
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,c.title,c.description,COUNT(CASE WHEN `+auth.EffectiveLibraryAccessSQL("w.library_id")+` THEN cw.work_id END),c.created_at,c.updated_at FROM collections c LEFT JOIN collection_works cw ON cw.collection_id=c.id LEFT JOIN works w ON w.id=cw.work_id WHERE c.user_id=? GROUP BY c.id ORDER BY c.updated_at DESC,c.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("list collections: %w", err)
	}
	defer rows.Close()
	var values []Collection
	for rows.Next() {
		var value Collection
		var created, updated string
		if err := rows.Scan(&value.ID, &value.Title, &value.Description, &value.WorkCount, &created, &updated); err != nil {
			return nil, fmt.Errorf("scan collection: %w", err)
		}
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) Get(ctx context.Context, actor auth.User, id string) (Collection, error) {
	var value Collection
	var created, updated string
	err := s.db.QueryRowContext(ctx, `SELECT id,title,description,created_at,updated_at FROM collections WHERE id=? AND user_id=?`, id, actor.ID).Scan(&value.ID, &value.Title, &value.Description, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Collection{}, ErrNotFound
	}
	if err != nil {
		return Collection{}, fmt.Errorf("get collection: %w", err)
	}
	value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	rows, err := s.db.QueryContext(ctx, `SELECT w.id,w.title,COALESCE(w.author,''),COALESCE(wc.image_url,''),cw.position FROM collection_works cw JOIN works w ON w.id=cw.work_id LEFT JOIN work_covers wc ON wc.id=w.selected_cover_id WHERE cw.collection_id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id")+` ORDER BY cw.position`, append([]any{id}, auth.LibraryAccessArgs(actor)...)...)
	if err != nil {
		return Collection{}, fmt.Errorf("list collection works: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var work Work
		if err := rows.Scan(&work.ID, &work.Title, &work.Author, &work.CoverURL, &work.Position); err != nil {
			return Collection{}, fmt.Errorf("scan collection work: %w", err)
		}
		value.Works = append(value.Works, work)
	}
	value.WorkCount = len(value.Works)
	return value, rows.Err()
}

func (s *Store) Create(ctx context.Context, actor auth.User, title, description string) (Collection, error) {
	title, description = strings.TrimSpace(title), strings.TrimSpace(description)
	if !validText(title, description) {
		return Collection{}, ErrInvalid
	}
	id, err := randomID()
	if err != nil {
		return Collection{}, fmt.Errorf("create collection id: %w", err)
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `INSERT INTO collections(id,user_id,title,description,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, actor.ID, title, description, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return Collection{}, fmt.Errorf("create collection: %w", err)
	}
	return Collection{ID: id, Title: title, Description: description, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Update(ctx context.Context, actor auth.User, id, title, description string) (Collection, error) {
	title, description = strings.TrimSpace(title), strings.TrimSpace(description)
	if !validText(title, description) {
		return Collection{}, ErrInvalid
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `UPDATE collections SET title=?,description=?,updated_at=? WHERE id=? AND user_id=?`, title, description, now.Format(time.RFC3339Nano), id, actor.ID)
	if err != nil {
		return Collection{}, fmt.Errorf("update collection: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return Collection{}, ErrNotFound
	}
	return s.Get(ctx, actor, id)
}

func (s *Store) Delete(ctx context.Context, actor auth.User, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM collections WHERE id=? AND user_id=?`, id, actor.ID)
	if err != nil {
		return fmt.Errorf("delete collection: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AddWork(ctx context.Context, actor auth.User, collectionID, workID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin collection add: %w", err)
	}
	defer tx.Rollback()
	if ok, err := owns(ctx, tx, actor.ID, collectionID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	var visible bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM works w WHERE w.id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id")+`)`, append([]any{workID}, auth.LibraryAccessArgs(actor)...)...).Scan(&visible); err != nil {
		return fmt.Errorf("authorize collection work: %w", err)
	}
	if !visible {
		return ErrInvalid
	}
	var position int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(position)+1,0) FROM collection_works WHERE collection_id=?`, collectionID).Scan(&position); err != nil {
		return fmt.Errorf("position collection work: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `INSERT INTO collection_works(collection_id,work_id,position,added_at) VALUES(?,?,?,?) ON CONFLICT(collection_id,work_id) DO NOTHING`, collectionID, workID, position, now); err != nil {
		return fmt.Errorf("add collection work: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE collections SET updated_at=? WHERE id=?`, now, collectionID); err != nil {
		return fmt.Errorf("touch collection: %w", err)
	}
	return tx.Commit()
}

func (s *Store) RemoveWork(ctx context.Context, actor auth.User, collectionID, workID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin collection removal: %w", err)
	}
	defer tx.Rollback()
	if ok, err := owns(ctx, tx, actor.ID, collectionID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM collection_works WHERE collection_id=? AND work_id=?`, collectionID, workID)
	if err != nil {
		return fmt.Errorf("remove collection work: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	if err := compact(ctx, tx, collectionID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Reorder(ctx context.Context, actor auth.User, collectionID string, workIDs []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin collection reorder: %w", err)
	}
	defer tx.Rollback()
	if ok, err := owns(ctx, tx, actor.ID, collectionID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	rows, err := tx.QueryContext(ctx, `SELECT cw.work_id FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), append([]any{collectionID}, auth.LibraryAccessArgs(actor)...)...)
	if err != nil {
		return fmt.Errorf("read collection order: %w", err)
	}
	existing := make(map[string]bool, len(workIDs))
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		existing[id] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(existing) != len(workIDs) {
		return ErrInvalid
	}
	for _, id := range workIDs {
		if !existing[id] {
			return ErrInvalid
		}
		delete(existing, id)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM collection_works WHERE collection_id=?`, collectionID); err != nil {
		return fmt.Errorf("clear collection order: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for position, id := range workIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO collection_works(collection_id,work_id,position,added_at) VALUES(?,?,?,?)`, collectionID, id, position, now); err != nil {
			return fmt.Errorf("save collection order: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE collections SET updated_at=? WHERE id=?`, now, collectionID); err != nil {
		return fmt.Errorf("touch collection: %w", err)
	}
	return tx.Commit()
}

func compact(ctx context.Context, tx *sql.Tx, collectionID string) error {
	rows, err := tx.QueryContext(ctx, `SELECT work_id FROM collection_works WHERE collection_id=? ORDER BY position`, collectionID)
	if err != nil {
		return fmt.Errorf("read collection positions: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM collection_works WHERE collection_id=?`, collectionID); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for position, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO collection_works(collection_id,work_id,position,added_at) VALUES(?,?,?,?)`, collectionID, id, position, now); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE collections SET updated_at=? WHERE id=?`, now, collectionID)
	return err
}

func owns(ctx context.Context, tx *sql.Tx, userID, collectionID string) (bool, error) {
	var ok bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM collections WHERE id=? AND user_id=?)`, collectionID, userID).Scan(&ok); err != nil {
		return false, fmt.Errorf("authorize collection: %w", err)
	}
	return ok, nil
}

func validText(title, description string) bool {
	return title != "" && len(title) <= 200 && len(description) <= 2000
}

func randomID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
