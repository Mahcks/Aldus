package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"modernc.org/sqlite"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

const manifestName = "manifest.json"

var (
	ErrForbidden = errors.New("administrator access required")
	ErrNotFound  = errors.New("backup not found")
)

type Archive struct {
	Name      string
	CreatedAt time.Time
	SizeBytes int64
}

type Manager struct {
	dataDir   string
	backupDir string
	version   string
	mu        sync.Mutex
}

func NewManager(dataDir, backupDir, version string) *Manager {
	return &Manager{
		dataDir:   dataDir,
		backupDir: backupDir,
		version:   version,
	}
}

func (m *Manager) List(actor auth.User) ([]Archive, error) {
	if !actor.Admin {
		return nil, ErrForbidden
	}
	entries, err := os.ReadDir(m.backupDir)
	if errors.Is(err, os.ErrNotExist) {
		return []Archive{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list backups: %w", err)
	}
	archives := make([]Archive, 0, len(entries))
	for _, entry := range entries {
		createdAt, ok := backupTime(entry.Name())
		if !ok || !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("inspect backup: %w", err)
		}
		archives = append(archives, Archive{
			Name:      entry.Name(),
			CreatedAt: createdAt,
			SizeBytes: info.Size(),
		})
	}
	sort.Slice(archives, func(i, j int) bool { return archives[i].CreatedAt.After(archives[j].CreatedAt) })
	return archives, nil
}

func (m *Manager) Create(ctx context.Context, actor auth.User) (Archive, error) {
	if !actor.Admin {
		return Archive{}, ErrForbidden
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := os.MkdirAll(m.backupDir, 0o750); err != nil {
		return Archive{}, fmt.Errorf("prepare backup directory: %w", err)
	}
	createdAt := time.Now().UTC()
	name := "aldus-backup-" + createdAt.Format("20060102T150405.000000000Z") + ".tar.gz"
	temporary := filepath.Join(m.backupDir, ".creating-"+name)
	defer os.Remove(temporary)
	if err := Create(ctx, m.dataDir, temporary, m.version); err != nil {
		return Archive{}, err
	}
	path := filepath.Join(m.backupDir, name)
	if err := os.Rename(temporary, path); err != nil {
		return Archive{}, fmt.Errorf("publish backup: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return Archive{}, fmt.Errorf("inspect backup: %w", err)
	}
	return Archive{Name: name, CreatedAt: createdAt, SizeBytes: info.Size()}, nil
}

func (m *Manager) Open(actor auth.User, name string) (*os.File, Archive, error) {
	if !actor.Admin {
		return nil, Archive{}, ErrForbidden
	}
	createdAt, ok := backupTime(name)
	if !ok {
		return nil, Archive{}, ErrNotFound
	}
	file, err := os.Open(filepath.Join(m.backupDir, name))
	if errors.Is(err, os.ErrNotExist) {
		return nil, Archive{}, ErrNotFound
	}
	if err != nil {
		return nil, Archive{}, fmt.Errorf("open backup: %w", err)
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, Archive{}, ErrNotFound
	}
	return file, Archive{Name: name, CreatedAt: createdAt, SizeBytes: info.Size()}, nil
}

func (m *Manager) Delete(actor auth.User, name string) error {
	if !actor.Admin {
		return ErrForbidden
	}
	if _, ok := backupTime(name); !ok {
		return ErrNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := os.Remove(filepath.Join(m.backupDir, name)); errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	} else if err != nil {
		return fmt.Errorf("delete backup: %w", err)
	}
	return nil
}

func backupTime(name string) (time.Time, bool) {
	value, ok := strings.CutPrefix(name, "aldus-backup-")
	if !ok {
		return time.Time{}, false
	}
	value, ok = strings.CutSuffix(value, ".tar.gz")
	if !ok {
		return time.Time{}, false
	}
	createdAt, err := time.Parse("20060102T150405.000000000Z", value)
	return createdAt, err == nil
}

type Manifest struct {
	Version                  string            `json:"version"`
	SchemaVersion            int               `json:"schema_version"`
	CreatedAt                time.Time         `json:"created_at"`
	ConnectorSecretsRedacted bool              `json:"connector_secrets_redacted,omitempty"`
	ManagedAcquisitionFiles  int               `json:"managed_acquisition_files,omitempty"`
	ExternalMediaExcluded    int               `json:"external_media_excluded,omitempty"`
	Files                    map[string]string `json:"files"`
}

type sqliteBackupConn interface {
	NewBackup(string) (*sqlite.Backup, error)
}

func Create(ctx context.Context, dataDir, archivePath, version string) error {
	dataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return fmt.Errorf("resolve data directory: %w", err)
	}
	archivePath, err = filepath.Abs(archivePath)
	if err != nil {
		return fmt.Errorf("resolve backup path: %w", err)
	}
	if _, err := os.Stat(archivePath); !errors.Is(err, os.ErrNotExist) {
		return errors.New("backup output already exists")
	}
	if relative, err := filepath.Rel(dataDir, archivePath); err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("backup output must be outside the data directory")
	}
	if info, err := os.Stat(filepath.Join(dataDir, "aldus.db")); err != nil || !info.Mode().IsRegular() {
		return errors.New("Aldus database was not found in the data directory")
	}
	temporary, err := os.MkdirTemp(filepath.Dir(archivePath), ".aldus-backup-*")
	if err != nil {
		return fmt.Errorf("create backup workspace: %w", err)
	}
	defer os.RemoveAll(temporary)
	snapshot := filepath.Join(temporary, "aldus.db")
	if err := snapshotDatabase(ctx, filepath.Join(dataDir, "aldus.db"), snapshot); err != nil {
		return err
	}
	// Redact only the isolated snapshot. The live database keeps its connector
	// credentials and in-flight state.
	if err := redactConnectorSecrets(ctx, snapshot); err != nil {
		return err
	}
	files, err := backupFiles(dataDir, snapshot)
	if err != nil {
		return err
	}
	schemaVersion, err := verifyDatabase(ctx, snapshot)
	if err != nil {
		return err
	}
	manifest := Manifest{
		Version:                  version,
		SchemaVersion:            schemaVersion,
		CreatedAt:                time.Now().UTC(),
		ConnectorSecretsRedacted: true,
		Files:                    make(map[string]string, len(files)),
	}
	for name := range files {
		if strings.HasPrefix(name, "acquisitions/") {
			manifest.ManagedAcquisitionFiles++
		}
	}
	if err := countExternalMedia(ctx, snapshot, &manifest.ExternalMediaExcluded); err != nil {
		return err
	}
	for name, path := range files {
		hash, err := fileHash(path)
		if err != nil {
			return fmt.Errorf("hash %s: %w", name, err)
		}
		manifest.Files[name] = hash
	}
	if err := writeArchive(archivePath, manifest, files); err != nil {
		os.Remove(archivePath)
		return err
	}
	return Verify(ctx, archivePath)
}

func countExternalMedia(ctx context.Context, snapshot string, count *int) error {
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(snapshot)+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM source_entries e JOIN library_sources s ON s.id=e.source_id WHERE e.state='registered' AND s.storage_kind='referenced' AND s.deleted_at IS NULL`).Scan(count); err != nil {
		return fmt.Errorf("count external media excluded from backup: %w", err)
	}
	return nil
}

func redactConnectorSecrets(ctx context.Context, path string) error {
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path))
	if err != nil {
		return fmt.Errorf("open backup snapshot for redaction: %w", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `PRAGMA secure_delete=ON;
			UPDATE acquisition_settings SET
				indexer_api_key='',
				qbittorrent_password='',
				indexer_url=CASE WHEN instr(indexer_url,'@')>0 THEN '' ELSE indexer_url END,
				qbittorrent_url=CASE WHEN instr(qbittorrent_url,'@')>0 THEN '' ELSE qbittorrent_url END;
			DELETE FROM sessions;
		UPDATE title_request_formats SET state='awaiting_release',next_search_at=NULL,error='Choose a release again after restoring this backup.' WHERE legacy_acquisition_request_id IN (SELECT id FROM acquisition_requests WHERE fulfillment_state='submitting');
		UPDATE acquisition_requests SET status='requested',download_state='',fulfillment_state='awaiting_selection',download_error='Choose a release again after restoring this backup.' WHERE fulfillment_state='submitting';
		UPDATE acquisition_requests SET selected_url=NULL;
		UPDATE acquisition_results SET download_url='';
		VACUUM`); err != nil {
		return fmt.Errorf("redact connector secrets from backup: %w", err)
	}
	return nil
}

func snapshotDatabase(ctx context.Context, source, destination string) error {
	db, err := database.Open(ctx, source)
	if err != nil {
		return fmt.Errorf("open database for backup: %w", err)
	}
	defer db.Close()
	connection, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("reserve database connection: %w", err)
	}
	defer connection.Close()
	return connection.Raw(func(driverConnection any) error {
		sourceConnection, ok := driverConnection.(sqliteBackupConn)
		if !ok {
			return errors.New("SQLite online backup is unavailable")
		}
		operation, err := sourceConnection.NewBackup(destination)
		if err != nil {
			return fmt.Errorf("start SQLite backup: %w", err)
		}
		if _, err := operation.Step(-1); err != nil {
			operation.Finish()
			return fmt.Errorf("copy SQLite database: %w", err)
		}
		if err := operation.Finish(); err != nil {
			return fmt.Errorf("finish SQLite backup: %w", err)
		}
		return nil
	})
}

func backupFiles(dataDir, snapshot string) (map[string]string, error) {
	files := map[string]string{"aldus.db": snapshot}
	err := filepath.WalkDir(dataDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == dataDir {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("backup refuses symbolic link %s", path)
		}
		relative, err := filepath.Rel(dataDir, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		if entry.IsDir() {
			if name == "models" {
				return filepath.SkipDir
			}
			return nil
		}
		if name == "aldus.db" || name == "aldus.db-wal" || name == "aldus.db-shm" {
			return nil
		}
		files[name] = path
		return nil
	})
	return files, err
}

func writeArchive(path string, manifest Manifest, files map[string]string) error {
	output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create backup: %w", err)
	}
	gzipWriter := gzip.NewWriter(output)
	tarWriter := tar.NewWriter(gzipWriter)
	closeWithError := func() error {
		if err := tarWriter.Close(); err != nil {
			return err
		}
		if err := gzipWriter.Close(); err != nil {
			return err
		}
		return output.Close()
	}
	manifestData, _ := json.MarshalIndent(manifest, "", "  ")
	if err := writeBytes(tarWriter, manifestName, manifestData, 0o600); err != nil {
		output.Close()
		return err
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if err := writeFile(tarWriter, name, files[name]); err != nil {
			output.Close()
			return err
		}
	}
	if err := closeWithError(); err != nil {
		return fmt.Errorf("finish backup: %w", err)
	}
	return nil
}

func Verify(ctx context.Context, archivePath string) error {
	temporary, err := os.MkdirTemp("", "aldus-verify-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	manifest, err := extractAndVerify(archivePath, temporary)
	if err != nil {
		return err
	}
	schemaVersion, err := verifyDatabase(ctx, filepath.Join(temporary, "aldus.db"))
	if err != nil {
		return err
	}
	if schemaVersion != manifest.SchemaVersion {
		return errors.New("backup schema version does not match its manifest")
	}
	if schemaVersion > database.SupportedSchemaVersion() {
		return fmt.Errorf("backup schema version %d is newer than supported version %d", schemaVersion, database.SupportedSchemaVersion())
	}
	return nil
}

func verifyDatabase(ctx context.Context, path string) (int, error) {
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if err != nil {
		return 0, fmt.Errorf("open restored database: %w", err)
	}
	defer db.Close()
	var result string
	if err := db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&result); err != nil || result != "ok" {
		return 0, fmt.Errorf("restored database integrity check failed: %v", err)
	}
	var schemaVersion int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&schemaVersion); err != nil {
		return 0, fmt.Errorf("read restored schema version: %w", err)
	}
	return schemaVersion, nil
}

func Restore(ctx context.Context, archivePath, dataDir string) error {
	if entries, err := os.ReadDir(dataDir); err == nil && len(entries) != 0 {
		return errors.New("restore data directory must be empty")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect restore directory: %w", err)
	}
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		return err
	}
	temporary, err := os.MkdirTemp(dataDir, ".aldus-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	manifest, err := extractAndVerify(archivePath, temporary)
	if err != nil {
		return err
	}
	schemaVersion, err := verifyDatabase(ctx, filepath.Join(temporary, "aldus.db"))
	if err != nil {
		return err
	}
	if schemaVersion != manifest.SchemaVersion || schemaVersion > database.SupportedSchemaVersion() {
		return errors.New("backup schema is incompatible with this Aldus version")
	}
	entries, err := os.ReadDir(temporary)
	if err != nil {
		return fmt.Errorf("read verified restore: %w", err)
	}
	moved := make([]string, 0, len(entries))
	for _, entry := range entries {
		source := filepath.Join(temporary, entry.Name())
		destination := filepath.Join(dataDir, entry.Name())
		if err := os.Rename(source, destination); err != nil {
			for i := len(moved) - 1; i >= 0; i-- {
				_ = os.Rename(filepath.Join(dataDir, moved[i]), filepath.Join(temporary, moved[i]))
			}
			return fmt.Errorf("publish restore: %w", err)
		}
		moved = append(moved, entry.Name())
	}
	return nil
}

func extractAndVerify(archivePath, destination string) (Manifest, error) {
	input, err := os.Open(archivePath)
	if err != nil {
		return Manifest{}, fmt.Errorf("open backup: %w", err)
	}
	defer input.Close()
	gzipReader, err := gzip.NewReader(input)
	if err != nil {
		return Manifest{}, fmt.Errorf("read backup compression: %w", err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	var manifest Manifest
	found := map[string]string{}
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Manifest{}, fmt.Errorf("read backup: %w", err)
		}
		name := filepath.Clean(filepath.FromSlash(header.Name))
		if name == "." || filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) || header.Typeflag != tar.TypeReg {
			return Manifest{}, errors.New("backup contains an unsafe entry")
		}
		if name == manifestName {
			if err := json.NewDecoder(io.LimitReader(tarReader, 1<<20)).Decode(&manifest); err != nil {
				return Manifest{}, fmt.Errorf("read backup manifest: %w", err)
			}
			continue
		}
		target := filepath.Join(destination, name)
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return Manifest{}, err
		}
		file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, fs.FileMode(header.Mode)&0o770)
		if err != nil {
			return Manifest{}, err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(io.MultiWriter(file, hash), tarReader)
		closeErr := file.Close()
		if copyErr != nil {
			return Manifest{}, copyErr
		}
		if closeErr != nil {
			return Manifest{}, closeErr
		}
		found[filepath.ToSlash(name)] = hex.EncodeToString(hash.Sum(nil))
	}
	if len(manifest.Files) == 0 || manifest.Files["aldus.db"] == "" {
		return Manifest{}, errors.New("backup manifest is missing")
	}
	if len(found) != len(manifest.Files) {
		return Manifest{}, errors.New("backup file list does not match its manifest")
	}
	for name, expected := range manifest.Files {
		if found[name] != expected {
			return Manifest{}, fmt.Errorf("backup checksum mismatch for %s", name)
		}
	}
	return manifest, nil
}

func fileHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeBytes(writer *tar.Writer, name string, data []byte, mode int64) error {
	if err := writer.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: int64(len(data)), ModTime: time.Now().UTC()}); err != nil {
		return err
	}
	_, err := writer.Write(data)
	return err
}

func writeFile(writer *tar.Writer, name, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if err := writer.WriteHeader(&tar.Header{Name: filepath.ToSlash(name), Mode: int64(info.Mode().Perm()), Size: info.Size(), ModTime: info.ModTime()}); err != nil {
		return err
	}
	_, err = io.Copy(writer, file)
	return err
}
