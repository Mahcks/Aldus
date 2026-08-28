package catalog

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrReferenced = errors.New("catalog resource is referenced")

func (s *Store) UpdateLibrary(ctx context.Context, actor auth.User, id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if ok, err := canManage(ctx, tx, actor, id); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `UPDATE libraries SET name=?,updated_at=? WHERE id=?`, name, time.Now().UTC().Format(time.RFC3339Nano), id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteLibrary(ctx context.Context, actor auth.User, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if ok, err := canManage(ctx, tx, actor, id); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM works WHERE library_id=?`, id).Scan(&n); err != nil {
		return err
	}
	if n != 0 {
		return ErrReferenced
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM libraries WHERE id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

type WorkUpdate struct {
	Title, Author, Description, ISBN, Publisher, Language string
	FirstPublishYear                                      int
	Subjects                                              []string
}

func (s *Store) UpdateWork(ctx context.Context, actor auth.User, id string, update WorkUpdate) error {
	update.Title = strings.TrimSpace(update.Title)
	update.Author = strings.TrimSpace(update.Author)
	update.Description = strings.TrimSpace(update.Description)
	update.ISBN = strings.TrimSpace(update.ISBN)
	update.Publisher = strings.TrimSpace(update.Publisher)
	update.Language = strings.TrimSpace(update.Language)
	if update.Title == "" || len(update.Title) > 500 || len(update.Author) > 500 || len([]rune(update.Description)) > maxWorkDescriptionRunes || len(update.ISBN) > 100 || len(update.Publisher) > 500 || len(update.Language) > 100 || update.FirstPublishYear < 0 || update.FirstPublishYear > 9999 {
		return ErrInvalid
	}
	subjects := make([]string, 0, len(update.Subjects))
	seen := make(map[string]bool, len(update.Subjects))
	for _, subject := range update.Subjects {
		subject = strings.TrimSpace(subject)
		normalized := strings.ToLower(subject)
		if subject == "" || seen[normalized] {
			continue
		}
		if len([]rune(subject)) > 200 || len(subjects) == maxWorkSubjects {
			return ErrInvalid
		}
		seen[normalized] = true
		subjects = append(subjects, subject)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE works SET title=?,author=?,updated_at=? WHERE (id=? AND EXISTS(SELECT 1 FROM library_members m WHERE m.library_id=works.library_id AND m.user_id=? AND m.role IN ('owner','editor'))) OR (id=? AND ?)`, update.Title, nullString(update.Author), now, id, actor.ID, id, actor.Admin)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO work_metadata(work_id,source,description,isbn,first_publish_year,publisher,language,subjects,updated_at) VALUES(?,'manual',?,?,?,?,?,?,?)
		ON CONFLICT(work_id) DO UPDATE SET description=excluded.description,isbn=excluded.isbn,first_publish_year=excluded.first_publish_year,publisher=excluded.publisher,language=excluded.language,subjects=excluded.subjects,updated_at=excluded.updated_at`, id, update.Description, update.ISBN, update.FirstPublishYear, update.Publisher, update.Language, strings.Join(subjects, ","), now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM work_subjects WHERE work_id=?`, id); err != nil {
		return err
	}
	for ordinal, subject := range subjects {
		if _, err := tx.ExecContext(ctx, `INSERT INTO work_subjects(work_id,ordinal,subject) VALUES(?,?,?)`, id, ordinal, subject); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteWork(ctx context.Context, actor auth.User, id string) error {
	work, err := s.Work(ctx, actor, id)
	if err != nil {
		return err
	}
	if ok, err := s.canEdit(ctx, actor, work.LibraryID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM representations WHERE work_id=?`, id).Scan(&n); err != nil {
		return err
	}
	if n != 0 {
		return ErrReferenced
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM works WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpdateRepresentation(ctx context.Context, actor auth.User, id, kind, label string) error {
	kind = strings.TrimSpace(kind)
	label = strings.TrimSpace(label)
	if !validRepresentationKind(kind) || label == "" || len(label) > 300 {
		return ErrInvalid
	}
	var existingKind string
	var mediaCount int
	err := s.db.QueryRowContext(ctx, `SELECT r.kind,COUNT(md.id) FROM representations r JOIN works w ON w.id=r.work_id LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? LEFT JOIN media md ON md.representation_id=r.id WHERE r.id=? AND (? OR m.role IN ('owner','editor')) GROUP BY r.id`, actor.ID, id, actor.Admin).Scan(&existingKind, &mediaCount)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if mediaCount > 0 && kind != existingKind {
		return ErrReferenced
	}
	result, err := s.db.ExecContext(ctx, `UPDATE representations SET kind=?,label=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE w.id=representations.work_id AND (? OR m.role IN ('owner','editor')))`, kind, label, time.Now().UTC().Format(time.RFC3339Nano), id, actor.ID, actor.Admin)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteRepresentation(ctx context.Context, actor auth.User, id string) error {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(md.id) FROM representations r JOIN works w ON w.id=r.work_id LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? LEFT JOIN media md ON md.representation_id=r.id WHERE r.id=? AND (? OR m.role IN ('owner','editor')) GROUP BY r.id`, actor.ID, id, actor.Admin).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if n != 0 {
		return ErrReferenced
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM representations WHERE id=? AND EXISTS(SELECT 1 FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE w.id=representations.work_id AND (? OR m.role IN ('owner','editor')))`, id, actor.ID, actor.Admin)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return ErrNotFound
	}
	return nil
}
