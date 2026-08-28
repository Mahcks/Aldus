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
	ErrNotFound            = errors.New("catalog resource not found")
	ErrForbidden           = errors.New("catalog operation forbidden")
	ErrInvalid             = errors.New("invalid catalog input")
	ErrLastOwner           = errors.New("cannot remove last owner")
	ErrMetadataUnavailable = errors.New("metadata provider unavailable")
)

type Store struct{ db *sql.DB }

func New(db *sql.DB) *Store { return &Store{db: db} }

type Library struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Role               string    `json:"role,omitempty"`
	Exclusive          bool      `json:"exclusive"`
	Effective          bool      `json:"effective"`
	CanRequest         bool      `json:"can_request_acquisitions"`
	CanBypassApproval  bool      `json:"can_bypass_acquisition_approval"`
	CanAdvancedRequest bool      `json:"can_advanced_acquisition_request"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type Membership struct {
	UserID             string `json:"user_id"`
	Username           string `json:"username"`
	DisplayName        string `json:"display_name"`
	Role               string `json:"role"`
	Exclusive          bool   `json:"exclusive"`
	CanRequest         bool   `json:"can_request_acquisitions"`
	CanBypassApproval  bool   `json:"can_bypass_acquisition_approval"`
	CanAdvancedRequest bool   `json:"can_advanced_acquisition_request"`
}

type Work struct {
	ID                                                  string `json:"id"`
	LibraryID                                           string `json:"library_id"`
	Title                                               string `json:"title"`
	Author                                              string `json:"author,omitempty"`
	CoverURL                                            string `json:"cover_url,omitempty"`
	CoverFit, GeneratedCoverStyle, GeneratedCoverLayout string
	CoverFocalX, CoverFocalY, GeneratedCoverTone        int
	CreatedAt                                           time.Time `json:"created_at"`
	UpdatedAt                                           time.Time `json:"updated_at"`
}

type WorkDetail struct {
	Work
	Description                                                        string
	ISBN                                                               string
	FirstPublishYear                                                   int
	Publisher, Language, Subjects                                      string
	SubjectValues                                                      []string
	InProgress                                                         bool
	CompletionPercent, ActiveSeconds, ReadingSeconds, ListeningSeconds int
	LastMode                                                           string
	ProgressUpdatedAt                                                  time.Time
	ReadingStatus                                                      string
}

type WorkSummary struct {
	ID, LibraryID, LibraryName, Title, Author, CoverURL                string
	CoverFit, GeneratedCoverStyle, GeneratedCoverLayout                string
	LastMode                                                           string
	ReadingStatus                                                      string
	Readable, Listenable, Synchronized, InProgress                     bool
	CompletionPercent, ActiveSeconds, ReadingSeconds, ListeningSeconds int
	CoverFocalX, CoverFocalY, GeneratedCoverTone                       int
	CreatedAt, UpdatedAt, ProgressUpdatedAt                            time.Time
}

type BrowseOptions struct {
	LibraryID, Query, Sort, Availability, Status string
	Limit, Offset                                int
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,can_bypass_acquisition_approval,can_advanced_acquisition_request,created_at) VALUES(?,?,'owner',1,1,1,?)`, id, actor.ID, stamp); err != nil {
		return Library{}, fmt.Errorf("create library owner: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Library{}, fmt.Errorf("commit library creation: %w", err)
	}
	return Library{ID: id, Name: name, Role: "owner", Effective: true, CanRequest: true, CanBypassApproval: true, CanAdvancedRequest: true, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Libraries(ctx context.Context, actor auth.User, limit, offset int) ([]Library, error) {
	limit, offset = page(limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT l.id,l.name,COALESCE(m.role,''),COALESCE(m.exclusive,0),(COALESCE(m.exclusive,0)=1 OR NOT EXISTS(SELECT 1 FROM library_members exclusive_override WHERE exclusive_override.user_id=? AND exclusive_override.exclusive=1)),COALESCE(m.can_request_acquisitions,0),COALESCE(m.can_bypass_acquisition_approval,0),COALESCE(m.can_advanced_acquisition_request,0),l.created_at,l.updated_at FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE ? OR m.user_id IS NOT NULL ORDER BY l.created_at,l.id LIMIT ? OFFSET ?`, actor.ID, actor.ID, actor.Admin, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	defer rows.Close()
	var result []Library
	for rows.Next() {
		var v Library
		var c, u string
		if err := rows.Scan(&v.ID, &v.Name, &v.Role, &v.Exclusive, &v.Effective, &v.CanRequest, &v.CanBypassApproval, &v.CanAdvancedRequest, &c, &u); err != nil {
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
	err := s.db.QueryRowContext(ctx, `SELECT l.id,l.name,COALESCE(m.role,''),COALESCE(m.exclusive,0),(COALESCE(m.exclusive,0)=1 OR NOT EXISTS(SELECT 1 FROM library_members exclusive_override WHERE exclusive_override.user_id=? AND exclusive_override.exclusive=1)),COALESCE(m.can_request_acquisitions,0),COALESCE(m.can_bypass_acquisition_approval,0),COALESCE(m.can_advanced_acquisition_request,0),l.created_at,l.updated_at FROM libraries l LEFT JOIN library_members m ON m.library_id=l.id AND m.user_id=? WHERE l.id=? AND (? OR m.user_id IS NOT NULL)`, actor.ID, actor.ID, id, actor.Admin).Scan(&v.ID, &v.Name, &v.Role, &v.Exclusive, &v.Effective, &v.CanRequest, &v.CanBypassApproval, &v.CanAdvancedRequest, &c, &u)
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

func (s *Store) SetMember(ctx context.Context, actor auth.User, libraryID, userID, role string, requested ...bool) error {
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
	var currentRole string
	if err := tx.QueryRowContext(ctx, `SELECT role FROM library_members WHERE library_id=? AND user_id=?`, libraryID, userID).Scan(&currentRole); errors.Is(err, sql.ErrNoRows) && !actor.Admin {
		return ErrNotFound
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var disabled int
	if err := tx.QueryRowContext(ctx, `SELECT disabled FROM users WHERE id=?`, userID).Scan(&disabled); errors.Is(err, sql.ErrNoRows) || disabled != 0 {
		return ErrInvalid
	} else if err != nil {
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
	canRequest := len(requested) > 0 && requested[0]
	canBypassApproval := len(requested) > 1 && requested[1]
	canAdvancedRequest := len(requested) > 2 && requested[2]
	exclusive := len(requested) > 3 && requested[3]
	if role == "owner" || role == "editor" {
		canRequest = true
		canBypassApproval = true
		canAdvancedRequest = true
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,exclusive,can_request_acquisitions,can_bypass_acquisition_approval,can_advanced_acquisition_request,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(library_id,user_id) DO UPDATE SET role=excluded.role,exclusive=excluded.exclusive,can_request_acquisitions=excluded.can_request_acquisitions,can_bypass_acquisition_approval=excluded.can_bypass_acquisition_approval,can_advanced_acquisition_request=excluded.can_advanced_acquisition_request`, libraryID, userID, role, exclusive, canRequest, canBypassApproval, canAdvancedRequest, time.Now().UTC().Format(time.RFC3339Nano))
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
	rows, err := s.db.QueryContext(ctx, `SELECT u.id,u.username,u.display_name,m.role,m.exclusive,m.can_request_acquisitions,m.can_bypass_acquisition_approval,m.can_advanced_acquisition_request FROM library_members m JOIN users u ON u.id=m.user_id WHERE m.library_id=? ORDER BY u.username_normalized`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Membership
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName, &m.Role, &m.Exclusive, &m.CanRequest, &m.CanBypassApproval, &m.CanAdvancedRequest); err != nil {
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
	return Work{ID: id, LibraryID: libraryID, Title: title, Author: authorName, CoverFit: "cover", CoverFocalX: 50, CoverFocalY: 50, GeneratedCoverStyle: "classic", GeneratedCoverTone: -1, GeneratedCoverLayout: "center", CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Works(ctx context.Context, actor auth.User, libraryID string, limit, offset int) ([]Work, error) {
	if ok, err := s.canAccessCatalog(ctx, actor, libraryID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotFound
	}
	limit, offset = page(limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT w.id,w.library_id,w.title,COALESCE(w.author,''),COALESCE(c.image_url,''),w.cover_fit,w.cover_focal_x,w.cover_focal_y,w.generated_cover_style,w.generated_cover_tone,w.generated_cover_layout,w.created_at,w.updated_at FROM works w LEFT JOIN work_covers c ON c.id=w.selected_cover_id WHERE w.library_id=? ORDER BY w.created_at,w.id LIMIT ? OFFSET ?`, libraryID, limit, offset)
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

func (s *Store) canAccessCatalog(ctx context.Context, actor auth.User, libraryID string) (bool, error) {
	var accessible bool
	args := []any{libraryID}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM libraries l WHERE l.id=? AND `+auth.EffectiveLibraryAccessSQL("l.id")+`)`, args...).Scan(&accessible)
	return accessible, err
}

func (s *Store) BrowseWorks(ctx context.Context, actor auth.User, options BrowseOptions) ([]WorkSummary, bool, error) {
	options.Query = strings.TrimSpace(options.Query)
	if len(options.Query) > 200 {
		return nil, false, ErrInvalid
	}
	if options.Sort == "" {
		options.Sort = "recent"
	}
	if options.Availability == "" {
		options.Availability = "all"
	}
	if !oneOf(options.Sort, "recent", "updated", "title", "author", "progress") || !oneOf(options.Availability, "all", "readable", "listenable", "synchronized", "in_progress") || (options.Status != "" && !oneOf(options.Status, "want_to_read", "reading", "finished")) {
		return nil, false, ErrInvalid
	}
	limit, offset := page(options.Limit, options.Offset)
	pattern := "%" + escapeLike(strings.ToLower(options.Query)) + "%"
	rows, err := s.db.QueryContext(ctx, `
		SELECT w.id,w.library_id,l.name,w.title,COALESCE(w.author,''),COALESCE(c.image_url,''),w.cover_fit,w.cover_focal_x,w.cover_focal_y,w.generated_cover_style,w.generated_cover_tone,w.generated_cover_layout,w.created_at,w.updated_at,
			EXISTS(SELECT 1 FROM representations r JOIN media m ON m.representation_id=r.id WHERE r.work_id=w.id AND m.kind='epub' AND `+availableMediaSQL("m")+`),
			EXISTS(SELECT 1 FROM representations r JOIN media m ON m.representation_id=r.id WHERE r.work_id=w.id AND m.kind IN ('audio','audiobook') AND `+availableMediaSQL("m")+`),
			EXISTS(SELECT 1 FROM alignments a JOIN media em ON em.id=a.epub_media_id JOIN representations er ON er.id=em.representation_id JOIN media am ON am.id=a.audio_media_id JOIN representations ar ON ar.id=am.representation_id WHERE a.state='ready' AND er.work_id=w.id AND ar.work_id=w.id AND `+availableMediaSQL("em")+` AND `+availableMediaSQL("am")+`),
			(EXISTS(SELECT 1 FROM progress p WHERE p.user_id=? AND p.work_id=w.id) OR EXISTS(SELECT 1 FROM representation_state rs JOIN representations r ON r.id=rs.representation_id WHERE rs.user_id=? AND r.work_id=w.id AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL))),
			MAX(COALESCE((SELECT p.updated_at FROM progress p WHERE p.user_id=? AND p.work_id=w.id),''),COALESCE((SELECT MAX(rs.updated_at) FROM representation_state rs JOIN representations r ON r.id=rs.representation_id WHERE rs.user_id=? AND r.work_id=w.id AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL)),'')),
			COALESCE((SELECT CAST(((s.ordinal + p.offset/1000000.0) * 100) / MAX(1,(SELECT MAX(last.ordinal)+1 FROM alignment_segments last WHERE last.alignment_id=p.alignment_id AND last.highlightable=1)) AS INTEGER) FROM progress p JOIN alignment_segments s ON s.alignment_id=p.alignment_id AND s.id=p.segment_id WHERE p.user_id=? AND p.work_id=w.id),0),
			COALESCE((SELECT SUM(a.active_seconds) FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id),0),
			COALESCE((SELECT SUM(a.active_seconds) FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id AND a.mode='read'),0),
			COALESCE((SELECT SUM(a.active_seconds) FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id AND a.mode='listen'),0),
			COALESCE((SELECT a.mode FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id ORDER BY a.last_seen_at DESC,a.id DESC LIMIT 1),''),
			COALESCE((SELECT s.status FROM user_work_statuses s WHERE s.user_id=? AND s.work_id=w.id),'')
		FROM works w
		JOIN libraries l ON l.id=w.library_id
		LEFT JOIN work_covers c ON c.id=w.selected_cover_id
		WHERE `+auth.EffectiveLibraryAccessSQL("w.library_id")+`
			AND (?='' OR w.library_id=?)
			AND (?='%%' OR lower(w.title) LIKE ? ESCAPE '\' OR lower(COALESCE(w.author,'')) LIKE ? ESCAPE '\')
			AND (?='all'
				OR (?='readable' AND EXISTS(SELECT 1 FROM representations r JOIN media m ON m.representation_id=r.id WHERE r.work_id=w.id AND m.kind='epub' AND `+availableMediaSQL("m")+`))
				OR (?='listenable' AND EXISTS(SELECT 1 FROM representations r JOIN media m ON m.representation_id=r.id WHERE r.work_id=w.id AND m.kind IN ('audio','audiobook') AND `+availableMediaSQL("m")+`))
				OR (?='synchronized' AND EXISTS(SELECT 1 FROM alignments a JOIN media em ON em.id=a.epub_media_id JOIN representations er ON er.id=em.representation_id JOIN media am ON am.id=a.audio_media_id JOIN representations ar ON ar.id=am.representation_id WHERE a.state='ready' AND er.work_id=w.id AND ar.work_id=w.id AND `+availableMediaSQL("em")+` AND `+availableMediaSQL("am")+`))
				OR (?='in_progress' AND (EXISTS(SELECT 1 FROM progress p WHERE p.user_id=? AND p.work_id=w.id) OR EXISTS(SELECT 1 FROM representation_state rs JOIN representations r ON r.id=rs.representation_id WHERE rs.user_id=? AND r.work_id=w.id AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL)))))
			AND (?='' OR EXISTS(SELECT 1 FROM user_work_statuses s WHERE s.user_id=? AND s.work_id=w.id AND s.status=?))
		ORDER BY
			CASE WHEN ?='title' THEN lower(w.title) END ASC,
			CASE WHEN ?='author' THEN lower(COALESCE(w.author,'')) END ASC,
			CASE WHEN ?='updated' THEN w.updated_at END DESC,
			CASE WHEN ?='recent' THEN w.created_at END DESC,
			CASE WHEN ?='progress' THEN MAX(COALESCE((SELECT p.updated_at FROM progress p WHERE p.user_id=? AND p.work_id=w.id),''),COALESCE((SELECT MAX(rs.updated_at) FROM representation_state rs JOIN representations r ON r.id=rs.representation_id WHERE rs.user_id=? AND r.work_id=w.id AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL)),'')) END DESC,
		w.id ASC
		LIMIT ? OFFSET ?`, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID,
		actor.ID, actor.ID, actor.ID, actor.ID, actor.Admin, actor.ID,
		options.LibraryID, options.LibraryID, pattern, pattern, pattern,
		options.Availability, options.Availability, options.Availability, options.Availability, options.Availability, actor.ID, actor.ID,
		options.Status, actor.ID, options.Status,
		options.Sort, options.Sort, options.Sort, options.Sort, options.Sort, actor.ID, actor.ID, limit+1, offset)
	if err != nil {
		return nil, false, fmt.Errorf("browse works: %w", err)
	}
	defer rows.Close()
	var out []WorkSummary
	for rows.Next() {
		var value WorkSummary
		var created, updated, progress string
		if err := rows.Scan(&value.ID, &value.LibraryID, &value.LibraryName, &value.Title, &value.Author, &value.CoverURL, &value.CoverFit, &value.CoverFocalX, &value.CoverFocalY, &value.GeneratedCoverStyle, &value.GeneratedCoverTone, &value.GeneratedCoverLayout, &created, &updated, &value.Readable, &value.Listenable, &value.Synchronized, &value.InProgress, &progress, &value.CompletionPercent, &value.ActiveSeconds, &value.ReadingSeconds, &value.ListeningSeconds, &value.LastMode, &value.ReadingStatus); err != nil {
			return nil, false, err
		}
		value.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		value.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		value.ProgressUpdatedAt, _ = time.Parse(time.RFC3339Nano, progress)
		out = append(out, value)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	return out, hasMore, nil
}

func (s *Store) Work(ctx context.Context, actor auth.User, id string) (Work, error) {
	var v Work
	var c, u string
	err := s.db.QueryRowContext(ctx, `SELECT w.id,w.library_id,w.title,COALESCE(w.author,''),COALESCE(c.image_url,''),w.cover_fit,w.cover_focal_x,w.cover_focal_y,w.generated_cover_style,w.generated_cover_tone,w.generated_cover_layout,w.created_at,w.updated_at FROM works w LEFT JOIN work_covers c ON c.id=w.selected_cover_id WHERE w.id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), append([]any{id}, auth.LibraryAccessArgs(actor)...)...).Scan(&v.ID, &v.LibraryID, &v.Title, &v.Author, &v.CoverURL, &v.CoverFit, &v.CoverFocalX, &v.CoverFocalY, &v.GeneratedCoverStyle, &v.GeneratedCoverTone, &v.GeneratedCoverLayout, &c, &u)
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

func (s *Store) WorkDetail(ctx context.Context, actor auth.User, id string) (WorkDetail, error) {
	work, err := s.Work(ctx, actor, id)
	if err != nil {
		return WorkDetail{}, err
	}
	value := WorkDetail{Work: work}
	err = s.db.QueryRowContext(ctx, `SELECT COALESCE(description,''),COALESCE(isbn,''),COALESCE(first_publish_year,0),COALESCE(publisher,''),COALESCE(language,''),COALESCE(subjects,'') FROM work_metadata WHERE work_id=?`, id).Scan(&value.Description, &value.ISBN, &value.FirstPublishYear, &value.Publisher, &value.Language, &value.Subjects)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return WorkDetail{}, fmt.Errorf("get work metadata: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT subject FROM work_subjects WHERE work_id=? ORDER BY ordinal`, id)
	if err != nil {
		return WorkDetail{}, fmt.Errorf("list work subjects: %w", err)
	}
	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			rows.Close()
			return WorkDetail{}, fmt.Errorf("scan work subject: %w", err)
		}
		value.SubjectValues = append(value.SubjectValues, subject)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return WorkDetail{}, fmt.Errorf("iterate work subjects: %w", err)
	}
	if err := rows.Close(); err != nil {
		return WorkDetail{}, fmt.Errorf("close work subjects: %w", err)
	}
	if len(value.SubjectValues) == 0 && value.Subjects != "" {
		value.SubjectValues = strings.Split(value.Subjects, ",")
	}
	var updated string
	err = s.db.QueryRowContext(ctx, `
		SELECT (p.work_id IS NOT NULL OR EXISTS(SELECT 1 FROM representation_state rs JOIN representations r ON r.id=rs.representation_id WHERE rs.user_id=? AND r.work_id=w.id AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL))),
			MAX(COALESCE(p.updated_at,''),COALESCE((SELECT MAX(rs.updated_at) FROM representation_state rs JOIN representations r ON r.id=rs.representation_id WHERE rs.user_id=? AND r.work_id=w.id AND (rs.epub_locator IS NOT NULL OR rs.audio_timestamp_ms IS NOT NULL)),'')),
			COALESCE(CAST(((s.ordinal + p.offset/1000000.0) * 100) / MAX(1,(SELECT MAX(last.ordinal)+1 FROM alignment_segments last WHERE last.alignment_id=p.alignment_id AND last.highlightable=1)) AS INTEGER),0),
			COALESCE((SELECT SUM(a.active_seconds) FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id),0),
			COALESCE((SELECT SUM(a.active_seconds) FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id AND a.mode='read'),0),
			COALESCE((SELECT SUM(a.active_seconds) FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id AND a.mode='listen'),0),
			COALESCE((SELECT a.mode FROM reading_activity_sessions a WHERE a.user_id=? AND a.work_id=w.id ORDER BY a.last_seen_at DESC,a.id DESC LIMIT 1),''),
			COALESCE((SELECT s.status FROM user_work_statuses s WHERE s.user_id=? AND s.work_id=w.id),'')
		FROM works w
		LEFT JOIN progress p ON p.work_id=w.id AND p.user_id=?
		LEFT JOIN alignment_segments s ON s.alignment_id=p.alignment_id AND s.id=p.segment_id
		WHERE w.id=?`, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, actor.ID, id).Scan(&value.InProgress, &updated, &value.CompletionPercent, &value.ActiveSeconds, &value.ReadingSeconds, &value.ListeningSeconds, &value.LastMode, &value.ReadingStatus)
	if err != nil {
		return WorkDetail{}, fmt.Errorf("get work progress summary: %w", err)
	}
	value.ProgressUpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return value, nil
}

func (s *Store) CreateRepresentation(ctx context.Context, actor auth.User, workID, kind, label string) (Representation, error) {
	kind = strings.TrimSpace(kind)
	label = strings.TrimSpace(label)
	if !validRepresentationKind(kind) || label == "" || len(label) > 300 {
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

func validRepresentationKind(kind string) bool {
	return kind == "epub" || kind == "audio" || kind == "audiobook"
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
	err := s.db.QueryRowContext(ctx, `SELECT r.id,r.work_id,r.kind,r.label,r.created_at,r.updated_at FROM representations r JOIN works w ON w.id=r.work_id WHERE r.id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), append([]any{id}, auth.LibraryAccessArgs(actor)...)...).Scan(&v.ID, &v.WorkID, &v.Kind, &v.Label, &c, &u)
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
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM alignments a WHERE a.id=? AND NOT EXISTS (SELECT 1 FROM alignment_inputs ai JOIN media md ON md.id=ai.media_id JOIN representations r ON r.id=md.representation_id JOIN works w ON w.id=r.work_id WHERE ai.alignment_id=a.id AND NOT `+auth.EffectiveLibraryAccessSQL("w.library_id")+`)`, append([]any{alignmentID}, auth.LibraryAccessArgs(actor)...)...).Scan(&count)
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
	err := rows.Scan(&v.ID, &v.LibraryID, &v.Title, &v.Author, &v.CoverURL, &v.CoverFit, &v.CoverFocalX, &v.CoverFocalY, &v.GeneratedCoverStyle, &v.GeneratedCoverTone, &v.GeneratedCoverLayout, &c, &u)
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
func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}
func escapeLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}
func availableMediaSQL(alias string) string {
	return `(` + alias + `.storage_kind='managed' OR EXISTS(SELECT 1 FROM media_locations ml JOIN source_entries se ON se.id=ml.source_entry_id JOIN library_sources ls ON ls.id=se.source_id WHERE ml.media_id=` + alias + `.id AND se.state='registered' AND se.sha256=` + alias + `.sha256 AND ls.enabled=1 AND ls.deleted_at IS NULL))`
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
