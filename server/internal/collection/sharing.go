package collection

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

// Collection c joins its creator u. A revoked or disabled creator cannot publish a list.
const sharedVisibleSQL = `c.shared_library_id IS NOT NULL AND u.disabled=0 AND (
    EXISTS(SELECT 1 FROM library_members m WHERE m.user_id=u.id AND m.library_id=c.shared_library_id AND m.exclusive=1)
    OR (NOT EXISTS(SELECT 1 FROM library_members m WHERE m.user_id=u.id AND m.exclusive=1)
        AND (u.is_admin=1 OR EXISTS(SELECT 1 FROM library_members m WHERE m.user_id=u.id AND m.library_id=c.shared_library_id)))
)`

func (s *Store) Shared(ctx context.Context, actor auth.User, limit, offset int) ([]Collection, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	args := append(auth.LibraryAccessArgs(actor), limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,c.title,c.description,c.shared_library_id,l.name,u.display_name,
        c.user_id,c.created_at,c.updated_at,COUNT(cw.work_id)
        FROM collections c JOIN users u ON u.id=c.user_id JOIN libraries l ON l.id=c.shared_library_id
        LEFT JOIN collection_works cw ON cw.collection_id=c.id
        WHERE `+sharedVisibleSQL+` AND `+auth.EffectiveLibraryAccessSQL("c.shared_library_id")+`
        GROUP BY c.id ORDER BY c.updated_at DESC,c.id LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []Collection{}
	for rows.Next() {
		var value Collection
		var owner, created, updated string
		if err := rows.Scan(&value.ID, &value.Title, &value.Description, &value.SharedLibraryID, &value.SharedLibraryName,
			&value.OwnerName, &owner, &created, &updated, &value.WorkCount); err != nil {
			return nil, err
		}
		value.CanEdit = owner == actor.ID
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) SharedDetail(ctx context.Context, actor auth.User, id string) (Collection, error) {
	return s.get(ctx, actor, id, true)
}

func (s *Store) Share(ctx context.Context, actor auth.User, id, libraryID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owner string
	if err := tx.QueryRowContext(ctx, `SELECT user_id FROM collections WHERE id=? AND user_id=?`, id, actor.ID).Scan(&owner); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if libraryID != "" {
		var allowed bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM libraries l WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+`)`, append([]any{libraryID}, auth.LibraryAccessArgs(actor)...)...).Scan(&allowed); err != nil {
			return err
		}
		if !allowed {
			return ErrNotFound
		}
		var incompatible bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND w.library_id<>?)`, id, libraryID).Scan(&incompatible); err != nil {
			return err
		}
		if incompatible {
			return ErrInvalid
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE collections SET shared_library_id=NULLIF(?,''),updated_at=? WHERE id=?`, libraryID, time.Now().UTC().Format(time.RFC3339Nano), id); err != nil {
		return err
	}
	return tx.Commit()
}
