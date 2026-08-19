package source

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var (
	ErrNotFound    = errors.New("source not found")
	ErrInvalid     = errors.New("invalid source")
	ErrUnavailable = errors.New("media unavailable")
)

type ValidationError struct {
	Code, Message string
}

func (e *ValidationError) Error() string { return e.Message }
func (e *ValidationError) Unwrap() error { return ErrInvalid }

type SourceRoot struct {
	ID, Label, Path string
}

type DirectoryListing struct {
	RootID, RelativePath, AbsolutePath string
	HasParent                          bool
	Directories                        []string
}

type Options struct {
	AllowedRoots []string
	ManagedRoot  string
	DataRoot     string
	MaxBytes     int64
}

type Store struct {
	db           *sql.DB
	allowedRoots []string
	blockedRoots []string
	managedRoot  string
	maxBytes     int64
	wake         chan struct{}
	done         chan struct{}
	startOnce    sync.Once
}

type LibrarySource struct {
	ID, LibraryID, Kind, Name, RootPath string
	Enabled, AutoImport                 bool
	CreatedAt, UpdatedAt                time.Time
}

func New(db *sql.DB, options Options) (*Store, error) {
	if options.MaxBytes <= 0 {
		options.MaxBytes = 2 << 30
	}
	s := &Store{db: db, maxBytes: options.MaxBytes, wake: make(chan struct{}, 1), done: make(chan struct{})}
	for _, root := range options.AllowedRoots {
		resolved, err := canonicalDirectory(root)
		if err != nil {
			return nil, fmt.Errorf("source root %q: %w", root, err)
		}
		s.allowedRoots = append(s.allowedRoots, resolved)
	}
	for _, root := range []string{options.ManagedRoot, options.DataRoot} {
		if root == "" {
			continue
		}
		absolute, err := filepath.Abs(root)
		if err != nil {
			return nil, err
		}
		s.blockedRoots = append(s.blockedRoots, filepath.Clean(absolute))
	}
	for _, allowed := range s.allowedRoots {
		for _, blocked := range s.blockedRoots {
			if within(blocked, allowed) || within(allowed, blocked) {
				return nil, fmt.Errorf("source root %q overlaps Aldus storage", allowed)
			}
		}
	}
	s.managedRoot = options.ManagedRoot
	return s, nil
}

func (s *Store) Create(ctx context.Context, actor auth.User, libraryID, name, root string, autoImport bool) (LibrarySource, error) {
	if !actor.Admin {
		return LibrarySource{}, ErrNotFound
	}
	name = strings.TrimSpace(name)
	resolved, err := s.validateRoot(root)
	if err != nil {
		return LibrarySource{}, err
	}
	if name == "" || len(name) > 200 {
		return LibrarySource{}, ErrInvalid
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries WHERE id=?`, libraryID).Scan(&exists); err != nil {
		return LibrarySource{}, err
	}
	if exists != 1 {
		return LibrarySource{}, ErrNotFound
	}
	id, err := randomID()
	if err != nil {
		return LibrarySource{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,auto_import,created_at,updated_at) VALUES(?,?,'local',?,?,1,?,?,?)`, id, libraryID, name, resolved, autoImport, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return LibrarySource{}, fmt.Errorf("create source: %w", err)
	}
	return LibrarySource{ID: id, LibraryID: libraryID, Kind: "local", Name: name, RootPath: resolved, Enabled: true, AutoImport: autoImport, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Roots(actor auth.User) ([]SourceRoot, error) {
	if !actor.Admin {
		return nil, ErrNotFound
	}
	result := make([]SourceRoot, len(s.allowedRoots))
	for i, root := range s.allowedRoots {
		sum := sha256.Sum256([]byte(root))
		result[i] = SourceRoot{ID: hex.EncodeToString(sum[:8]), Label: filepath.Base(root), Path: root}
	}
	return result, nil
}

func (s *Store) Directories(actor auth.User, rootID, relative string) (DirectoryListing, error) {
	if !actor.Admin {
		return DirectoryListing{}, ErrNotFound
	}
	var selected SourceRoot
	roots, _ := s.Roots(actor)
	for _, root := range roots {
		if root.ID == rootID {
			selected = root
			break
		}
	}
	if selected.ID == "" {
		return DirectoryListing{}, ErrNotFound
	}
	relative = filepath.FromSlash(relative)
	if filepath.IsAbs(relative) || relative == "." || filepath.Clean(relative) != relative || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		if relative != "" {
			return DirectoryListing{}, validation("malformed_path", "Choose a folder inside an available media root.")
		}
	}
	full := filepath.Join(selected.Path, relative)
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil {
		return DirectoryListing{}, validation("path_not_found", "That folder no longer exists on the Aldus server.")
	}
	if resolved != full || !within(selected.Path, resolved) {
		return DirectoryListing{}, validation("symlink_root", "Linked folders cannot be selected as media sources.")
	}
	entries, err := os.ReadDir(full)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return DirectoryListing{}, validation("inaccessible", "Aldus does not have permission to read that folder.")
		}
		return DirectoryListing{}, validation("path_not_found", "That folder is unavailable on the Aldus server.")
	}
	directories := []string{}
	for _, entry := range entries {
		if entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			directories = append(directories, entry.Name())
		}
	}
	return DirectoryListing{RootID: selected.ID, RelativePath: filepath.ToSlash(relative), AbsolutePath: full, HasParent: relative != "", Directories: directories}, nil
}

func (s *Store) List(ctx context.Context, actor auth.User, libraryID string) ([]LibrarySource, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT ls.id,ls.library_id,ls.kind,ls.name,CASE WHEN ? THEN ls.root_path ELSE '' END,ls.enabled,ls.auto_import,ls.created_at,ls.updated_at FROM library_sources ls LEFT JOIN library_members lm ON lm.library_id=ls.library_id AND lm.user_id=? WHERE ls.library_id=? AND ls.deleted_at IS NULL AND (? OR lm.role IN ('owner','editor')) ORDER BY ls.created_at,ls.id`, actor.Admin, actor.ID, libraryID, actor.Admin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LibrarySource
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) Get(ctx context.Context, actor auth.User, libraryID, id string) (LibrarySource, error) {
	if ok, err := s.canScan(ctx, actor, libraryID, id); err != nil || !ok {
		if err != nil {
			return LibrarySource{}, err
		}
		return LibrarySource{}, ErrNotFound
	}
	v, err := s.get(ctx, libraryID, id)
	if !actor.Admin {
		v.RootPath = ""
	}
	return v, err
}

// EnqueueDownloadScan accepts only completed paths physically contained by the
// selected source. The normal scanner remains the sole importer of those bytes.
func (s *Store) EnqueueDownloadScan(ctx context.Context, libraryID, sourceID, completedPath string) error {
	_, err := s.EnqueueAcquisitionScan(ctx, libraryID, sourceID, "", completedPath)
	return err
}

// EnqueueAcquisitionScan durably binds a completed download to the exact scan
// that will discover it. Callers must retry ErrActiveScan rather than treating
// an unrelated in-flight scan as ownership of the download.
func (s *Store) EnqueueAcquisitionScan(ctx context.Context, libraryID, sourceID, requestID, completedPath string) (string, error) {
	v, err := s.get(ctx, libraryID, sourceID)
	if err != nil || !v.Enabled {
		return "", ErrNotFound
	}
	resolved, err := filepath.EvalSymlinks(completedPath)
	if err != nil {
		return "", validation("download_path_unavailable", "The completed download is not visible to Aldus.")
	}
	if !within(v.RootPath, resolved) {
		return "", validation("download_path_outside_source", "The completed download is outside the selected Aldus Source.")
	}
	if requestID != "" {
		var existing string
		err := s.db.QueryRowContext(ctx, `SELECT id FROM source_scans WHERE acquisition_request_id=? AND source_id=?`, requestID, sourceID).Scan(&existing)
		if err == nil {
			return existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	scan, err := s.enqueueLinkedScan(ctx, libraryID, sourceID, requestID)
	if err != nil {
		return "", err
	}
	return scan.ID, nil
}

func (s *Store) Update(ctx context.Context, actor auth.User, libraryID, id, name, root string, enabled, autoImport bool) error {
	if !actor.Admin {
		return ErrNotFound
	}
	name = strings.TrimSpace(name)
	resolved, err := s.validateRoot(root)
	if err != nil {
		return err
	}
	if name == "" || len(name) > 200 {
		return ErrInvalid
	}
	result, err := s.db.ExecContext(ctx, `UPDATE library_sources SET name=?,root_path=?,enabled=?,auto_import=?,updated_at=? WHERE id=? AND library_id=? AND deleted_at IS NULL`, name, resolved, enabled, autoImport, time.Now().UTC().Format(time.RFC3339Nano), id, libraryID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Delete(ctx context.Context, actor auth.User, libraryID, id string) error {
	if !actor.Admin {
		return ErrNotFound
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `UPDATE library_sources SET enabled=0,deleted_at=?,updated_at=? WHERE id=? AND library_id=? AND deleted_at IS NULL`, now, now, id, libraryID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) OpenMedia(ctx context.Context, mediaID string, verifyHash bool) (*os.File, error) {
	var kind, path, expectedHash, entryPath, root, entryHash, entryState, modified string
	var size int64
	var enabled int
	err := s.db.QueryRowContext(ctx, `SELECT m.storage_kind,m.path,m.sha256,COALESCE(e.relative_path,''),COALESCE(ls.root_path,''),COALESCE(e.sha256,''),COALESCE(e.state,''),COALESCE(e.size_bytes,0),COALESCE(e.modified_at,''),COALESCE(ls.enabled,0) FROM media m LEFT JOIN source_entries e ON e.id=COALESCE((SELECT ml.source_entry_id FROM media_locations ml JOIN source_entries se ON se.id=ml.source_entry_id JOIN library_sources sl ON sl.id=se.source_id AND sl.deleted_at IS NULL WHERE ml.media_id=m.id AND se.state='registered' AND se.sha256=m.sha256 AND sl.enabled=1 ORDER BY ml.created_at,ml.source_entry_id LIMIT 1),m.source_entry_id) LEFT JOIN library_sources ls ON ls.id=e.source_id AND ls.deleted_at IS NULL WHERE m.id=?`, mediaID).Scan(&kind, &path, &expectedHash, &entryPath, &root, &entryHash, &entryState, &size, &modified, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if kind == "managed" {
		return openRegular(filepath.Join(s.managedRoot, "media"), path)
	}
	if kind != "referenced" || enabled == 0 || entryState != "registered" || entryHash != expectedHash {
		return nil, ErrUnavailable
	}
	file, err := openRegular(root, entryPath)
	if err != nil {
		return nil, ErrUnavailable
	}
	info, err := file.Stat()
	if err != nil || info.Size() != size || info.ModTime().UTC().Format(time.RFC3339Nano) != modified {
		file.Close()
		return nil, ErrUnavailable
	}
	if verifyHash {
		// Alignment inputs are always fully re-hashed. HTTP reads use the inventory's
		// size and nanosecond mtime so Range requests do not hash an audiobook per request.
		h := sha256.New()
		if _, err := io.Copy(h, file); err != nil || hex.EncodeToString(h.Sum(nil)) != expectedHash {
			file.Close()
			return nil, ErrUnavailable
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			file.Close()
			return nil, err
		}
	}
	return file, nil
}

func (s *Store) validateRoot(root string) (string, error) {
	resolved, err := canonicalDirectory(root)
	if err != nil {
		return "", err
	}
	for _, blocked := range s.blockedRoots {
		if within(blocked, resolved) || within(resolved, blocked) {
			return "", validation("overlaps_aldus_storage", "A media source cannot contain or overlap Aldus data storage.")
		}
	}
	allowed := false
	for _, parent := range s.allowedRoots {
		if within(parent, resolved) {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", validation("outside_allowed_roots", "Choose a folder inside a media root configured by the Aldus operator.")
	}
	return resolved, nil
}

func canonicalDirectory(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", validation("malformed_path", "The source path must be an absolute server-visible path.")
	}
	clean := filepath.Clean(path)
	if filepath.Dir(clean) == clean {
		return "", validation("unsafe_root", "A filesystem volume root cannot be used as a media source.")
	}
	info, err := os.Lstat(clean)
	if errors.Is(err, os.ErrNotExist) {
		return "", validation("path_not_found", "That folder does not exist on the Aldus server.")
	}
	if errors.Is(err, os.ErrPermission) {
		return "", validation("inaccessible", "Aldus does not have permission to access that folder.")
	}
	if err != nil {
		return "", validation("malformed_path", "That source path is not valid.")
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", validation("symlink_root", "Linked folders cannot be used as media source roots.")
	}
	if !info.IsDir() {
		return "", validation("not_directory", "The selected source path is not a directory.")
	}
	resolved, err := filepath.EvalSymlinks(clean)
	if err != nil || resolved != clean {
		return "", validation("symlink_root", "Linked folders cannot be used as media source roots.")
	}
	directory, err := os.Open(resolved)
	if errors.Is(err, os.ErrPermission) {
		return "", validation("inaccessible", "Aldus does not have permission to read that folder.")
	}
	if err != nil {
		return "", validation("inaccessible", "Aldus cannot read that folder.")
	}
	directory.Close()
	return resolved, nil
}

func validation(code, message string) error {
	return &ValidationError{Code: code, Message: message}
}

func openRegular(root, relative string) (*os.File, error) {
	if filepath.IsAbs(relative) || relative == "." || filepath.Clean(relative) != relative || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, ErrInvalid
	}
	full := filepath.Join(root, relative)
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil || resolved != full || !within(root, resolved) {
		return nil, ErrInvalid
	}
	info, err := os.Lstat(full)
	if err != nil || !info.Mode().IsRegular() {
		return nil, ErrInvalid
	}
	file, err := os.Open(full)
	if err != nil {
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		file.Close()
		return nil, ErrInvalid
	}
	return file, nil
}

func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func (s *Store) get(ctx context.Context, libraryID, id string) (LibrarySource, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,library_id,kind,name,root_path,enabled,auto_import,created_at,updated_at FROM library_sources WHERE id=? AND library_id=? AND deleted_at IS NULL`, id, libraryID)
	v, err := scan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return LibrarySource{}, ErrNotFound
	}
	return v, err
}

type scanner interface{ Scan(...any) error }

func scan(row scanner) (LibrarySource, error) {
	var v LibrarySource
	var enabled, autoImport int
	var c, u string
	err := row.Scan(&v.ID, &v.LibraryID, &v.Kind, &v.Name, &v.RootPath, &enabled, &autoImport, &c, &u)
	v.Enabled = enabled == 1
	v.AutoImport = autoImport == 1
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, c)
	v.UpdatedAt, _ = time.Parse(time.RFC3339Nano, u)
	return v, err
}
func randomID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
