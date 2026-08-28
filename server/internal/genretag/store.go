package genretag

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/mahcks/aldus/server/internal/auth"
	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
	"golang.org/x/text/unicode/norm"
)

var (
	ErrForbidden    = errors.New("genre tag operation forbidden")
	ErrInvalid      = errors.New("invalid genre tag")
	ErrNotFound     = errors.New("genre tag not found")
	ErrWorkNotFound = errors.New("work not found")
	ErrConflict     = errors.New("genre tag already exists")
)

type Tag struct {
	ID       string
	Label    string
	Icon     string
	Keywords []string
}

type UnmatchedSubject struct {
	Subject   string
	WorkCount int
}

type Store struct {
	db      *sql.DB
	queries *dbsql.Queries
}

func New(db *sql.DB) *Store {
	return &Store{db: db, queries: dbsql.New(db)}
}

func (s *Store) List(ctx context.Context) ([]Tag, error) {
	rows, err := s.queries.ListGenreTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("list genre tags: %w", err)
	}
	tags := make([]Tag, 0, len(rows))
	for _, row := range rows {
		if len(tags) == 0 || tags[len(tags)-1].ID != row.ID {
			tags = append(tags, Tag{ID: row.ID, Label: row.Label, Icon: row.Icon})
		}
		if row.Keyword != "" {
			tags[len(tags)-1].Keywords = append(tags[len(tags)-1].Keywords, row.Keyword)
		}
	}
	return tags, nil
}

func (s *Store) Match(ctx context.Context, subjects []string) ([]Tag, error) {
	tags, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	return match(tags, subjects), nil
}

func (s *Store) ForWork(ctx context.Context, workID string, subjects []string) ([]Tag, bool, error) {
	var manual bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM work_genre_overrides WHERE work_id=?)`, workID).Scan(&manual); err != nil {
		return nil, false, fmt.Errorf("read work genre mode: %w", err)
	}
	if !manual {
		tags, err := s.Match(ctx, subjects)
		return tags, false, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT gt.id,gt.label,gt.icon FROM work_genre_tags wgt JOIN genre_tags gt ON gt.id=wgt.genre_tag_id WHERE wgt.work_id=? ORDER BY gt.label COLLATE NOCASE,gt.id`, workID)
	if err != nil {
		return nil, false, fmt.Errorf("list manual work genres: %w", err)
	}
	defer rows.Close()
	var tags []Tag
	for rows.Next() {
		var tag Tag
		if err := rows.Scan(&tag.ID, &tag.Label, &tag.Icon); err != nil {
			return nil, false, fmt.Errorf("scan manual work genre: %w", err)
		}
		tags = append(tags, tag)
	}
	return tags, true, rows.Err()
}

func (s *Store) SetWork(ctx context.Context, actor auth.User, workID string, tagIDs []string) error {
	if len(tagIDs) > 50 {
		return ErrInvalid
	}
	ids := make([]string, 0, len(tagIDs))
	seen := make(map[string]bool, len(tagIDs))
	for _, id := range tagIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return ErrInvalid
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin manual work genres: %w", err)
	}
	defer tx.Rollback()
	if ok, err := editableWork(ctx, tx, actor, workID); err != nil {
		return err
	} else if !ok {
		return ErrWorkNotFound
	}
	for _, id := range ids {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM genre_tags WHERE id=?)`, id).Scan(&exists); err != nil {
			return fmt.Errorf("validate work genre: %w", err)
		}
		if !exists {
			return ErrInvalid
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO work_genre_overrides(work_id) VALUES(?)`, workID); err != nil {
		return fmt.Errorf("set manual work genre mode: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM work_genre_tags WHERE work_id=?`, workID); err != nil {
		return fmt.Errorf("clear manual work genres: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO work_genre_tags(work_id,genre_tag_id) VALUES(?,?)`, workID, id); err != nil {
			return fmt.Errorf("assign manual work genre: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit manual work genres: %w", err)
	}
	return nil
}

func (s *Store) ResetWork(ctx context.Context, actor auth.User, workID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin automatic work genres: %w", err)
	}
	defer tx.Rollback()
	if ok, err := editableWork(ctx, tx, actor, workID); err != nil {
		return err
	} else if !ok {
		return ErrWorkNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM work_genre_overrides WHERE work_id=?`, workID); err != nil {
		return fmt.Errorf("reset automatic work genres: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit automatic work genres: %w", err)
	}
	return nil
}

func editableWork(ctx context.Context, tx *sql.Tx, actor auth.User, workID string) (bool, error) {
	var ok bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM works w LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE w.id=? AND (? OR m.role IN ('owner','editor')))`, actor.ID, workID, actor.Admin).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("authorize work genre edit: %w", err)
	}
	return ok, nil
}

func match(tags []Tag, subjects []string) []Tag {
	matched := make([]Tag, 0, len(tags))
	for _, tag := range tags {
		found := false
		for _, subject := range subjects {
			for _, keyword := range tag.Keywords {
				if containsPhrase(subject, keyword) {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			matched = append(matched, Tag{ID: tag.ID, Label: tag.Label, Icon: tag.Icon})
		}
	}
	return matched
}

func containsPhrase(subject, keyword string) bool {
	subjectTokens := normalizedTokens(subject)
	keywordTokens := normalizedTokens(keyword)
	if len(keywordTokens) == 0 || len(keywordTokens) > len(subjectTokens) {
		return false
	}
	for start := 0; start <= len(subjectTokens)-len(keywordTokens); start++ {
		found := true
		for offset := range keywordTokens {
			if subjectTokens[start+offset] != keywordTokens[offset] {
				found = false
				break
			}
		}
		if found {
			return true
		}
	}
	return false
}

func normalizedTokens(value string) []string {
	var normalized strings.Builder
	for _, r := range strings.ToLower(norm.NFC.String(value)) {
		switch {
		case unicode.IsLetter(r), unicode.IsNumber(r):
			normalized.WriteRune(r)
		case r == '\'', r == '\u2019':
		default:
			normalized.WriteByte(' ')
		}
	}
	return strings.Fields(normalized.String())
}

func (s *Store) Unmatched(ctx context.Context, actor auth.User, limit, offset int) ([]UnmatchedSubject, bool, error) {
	if !actor.Admin {
		return nil, false, ErrForbidden
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	tags, err := s.List(ctx)
	if err != nil {
		return nil, false, err
	}
	// ponytail: aggregate in process so Unicode normalization matches the matcher;
	// move this into a stored normalized column only if real library size makes it slow.
	rows, err := s.db.QueryContext(ctx, `SELECT subject,work_id FROM work_subjects ORDER BY subject,work_id`)
	if err != nil {
		return nil, false, fmt.Errorf("list imported subjects: %w", err)
	}
	defer rows.Close()
	type subjectGroup struct {
		subject string
		works   map[string]bool
	}
	groups := make(map[string]*subjectGroup)
	for rows.Next() {
		var subject, workID string
		if err := rows.Scan(&subject, &workID); err != nil {
			return nil, false, fmt.Errorf("scan imported subject: %w", err)
		}
		key := strings.Join(normalizedTokens(subject), " ")
		if key == "" {
			continue
		}
		group := groups[key]
		if group == nil {
			group = &subjectGroup{subject: subject, works: make(map[string]bool)}
			groups[key] = group
		}
		group.works[workID] = true
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate imported subjects: %w", err)
	}
	items := make([]UnmatchedSubject, 0, len(groups))
	for _, group := range groups {
		if len(match(tags, []string{group.subject})) == 0 {
			items = append(items, UnmatchedSubject{Subject: group.subject, WorkCount: len(group.works)})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].WorkCount != items[j].WorkCount {
			return items[i].WorkCount > items[j].WorkCount
		}
		return strings.ToLower(items[i].Subject) < strings.ToLower(items[j].Subject)
	})
	if offset >= len(items) {
		return []UnmatchedSubject{}, false, nil
	}
	items = items[offset:]
	if len(items) > limit {
		return items[:limit], true, nil
	}
	return items, false, nil
}

func (s *Store) Create(ctx context.Context, actor auth.User, label, icon string, keywords []string) (Tag, error) {
	if !actor.Admin {
		return Tag{}, ErrForbidden
	}
	label, icon, keywords, err := validate(label, icon, keywords)
	if err != nil {
		return Tag{}, err
	}
	id, err := randomID()
	if err != nil {
		return Tag{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Tag{}, fmt.Errorf("begin genre tag create: %w", err)
	}
	defer tx.Rollback()
	queries := s.queries.WithTx(tx)
	if err := queries.CreateGenreTag(ctx, dbsql.CreateGenreTagParams{ID: id, Label: label, Icon: icon}); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return Tag{}, ErrConflict
		}
		return Tag{}, fmt.Errorf("create genre tag: %w", err)
	}
	if err := replaceKeywords(ctx, queries, id, keywords); err != nil {
		return Tag{}, err
	}
	if err := tx.Commit(); err != nil {
		return Tag{}, fmt.Errorf("commit genre tag create: %w", err)
	}
	return Tag{ID: id, Label: label, Icon: icon, Keywords: keywords}, nil
}

func (s *Store) Update(ctx context.Context, actor auth.User, id, label, icon string, keywords []string) (Tag, error) {
	if !actor.Admin {
		return Tag{}, ErrForbidden
	}
	label, icon, keywords, err := validate(label, icon, keywords)
	if err != nil {
		return Tag{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Tag{}, fmt.Errorf("begin genre tag update: %w", err)
	}
	defer tx.Rollback()
	queries := s.queries.WithTx(tx)
	updated, err := queries.UpdateGenreTag(ctx, dbsql.UpdateGenreTagParams{ID: id, Label: label, Icon: icon})
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return Tag{}, ErrConflict
		}
		return Tag{}, fmt.Errorf("update genre tag: %w", err)
	}
	if updated == 0 {
		return Tag{}, ErrNotFound
	}
	if err := replaceKeywords(ctx, queries, id, keywords); err != nil {
		return Tag{}, err
	}
	if err := tx.Commit(); err != nil {
		return Tag{}, fmt.Errorf("commit genre tag update: %w", err)
	}
	return Tag{ID: id, Label: label, Icon: icon, Keywords: keywords}, nil
}

func (s *Store) Delete(ctx context.Context, actor auth.User, id string) error {
	if !actor.Admin {
		return ErrForbidden
	}
	deleted, err := s.queries.DeleteGenreTag(ctx, id)
	if err != nil {
		return fmt.Errorf("delete genre tag: %w", err)
	}
	if deleted == 0 {
		return ErrNotFound
	}
	return nil
}

func validate(label, icon string, keywords []string) (string, string, []string, error) {
	label = strings.TrimSpace(label)
	icon = strings.TrimSpace(icon)
	if label == "" || len(label) > 80 || icon == "" || len(icon) > 64 || len(keywords) == 0 || len(keywords) > 50 {
		return "", "", nil, ErrInvalid
	}
	cleaned := make([]string, 0, len(keywords))
	seen := make(map[string]bool, len(keywords))
	for _, keyword := range keywords {
		keyword = strings.TrimSpace(keyword)
		normalized := strings.Join(normalizedTokens(keyword), " ")
		if keyword == "" || len(keyword) > 100 || normalized == "" {
			return "", "", nil, ErrInvalid
		}
		if !seen[normalized] {
			seen[normalized] = true
			cleaned = append(cleaned, keyword)
		}
	}
	return label, icon, cleaned, nil
}

func replaceKeywords(ctx context.Context, queries *dbsql.Queries, tagID string, keywords []string) error {
	if err := queries.DeleteGenreTagKeywords(ctx, tagID); err != nil {
		return fmt.Errorf("clear genre tag keywords: %w", err)
	}
	for _, keyword := range keywords {
		id, err := randomID()
		if err != nil {
			return err
		}
		if err := queries.CreateGenreTagKeyword(ctx, dbsql.CreateGenreTagKeywordParams{ID: id, GenreTagID: tagID, Keyword: keyword}); err != nil {
			return fmt.Errorf("create genre tag keyword: %w", err)
		}
	}
	return nil
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate genre tag id: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
