package source

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrActiveScan = errors.New("source scan already active")

type Scan struct {
	ID           string
	SourceID     string
	State        string
	Error        string
	FilesVisited int
	Supported    int
	EPUB         int
	Audio        int
	New          int
	Changed      int
	Unchanged    int
	Missing      int
	Problems     int
	AutoImported int
	CreatedAt    time.Time
	StartedAt    *time.Time
	FinishedAt   *time.Time
}

type Entry struct {
	ID           string
	SourceID     string
	RelativePath string
	Kind         string
	SHA256       string
	State        string
	Error        string
	SizeBytes    int64
	ModifiedAt   time.Time
	Metadata     json.RawMessage
	PathHints    json.RawMessage
}

func (s *Store) Start(ctx context.Context) error {
	var startErr error
	s.startOnce.Do(func() {
		startErr = s.recoverScans(ctx)
		if startErr == nil {
			go s.scanLoop(ctx)
			s.signalScan()
		}
	})
	return startErr
}

func (s *Store) recoverScans(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `UPDATE source_scans SET state='pending',started_at=NULL WHERE state='scanning'`)
	return err
}

func (s *Store) Wait() {
	<-s.done
}

func (s *Store) EnqueueScan(ctx context.Context, actor auth.User, libraryID, sourceID string) (Scan, error) {
	if ok, err := s.canScan(ctx, actor, libraryID, sourceID); err != nil || !ok {
		if err != nil {
			return Scan{}, err
		}
		return Scan{}, ErrNotFound
	}
	return s.enqueueScan(ctx, libraryID, sourceID)
}

func (s *Store) enqueueScan(ctx context.Context, libraryID, sourceID string) (Scan, error) {
	return s.enqueueLinkedScan(ctx, libraryID, sourceID, "")
}

func (s *Store) enqueueLinkedScan(ctx context.Context, libraryID, sourceID, requestID string) (Scan, error) {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_sources WHERE id=? AND library_id=? AND enabled=1 AND deleted_at IS NULL`, sourceID, libraryID).Scan(&exists); err != nil {
		return Scan{}, err
	}
	if exists != 1 {
		return Scan{}, ErrNotFound
	}
	id, err := randomID()
	if err != nil {
		return Scan{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES(?,?,'pending',?,NULLIF(?,''))`, id, sourceID, now.Format(time.RFC3339Nano), requestID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return Scan{}, ErrActiveScan
		}
		return Scan{}, err
	}
	if requestID != "" {
		if err := s.saveAcquisitionOutcome(ctx, requestID, id, "pending", "", "", ""); err != nil {
			_, _ = s.db.ExecContext(ctx, `DELETE FROM source_scans WHERE id=?`, id)
			return Scan{}, err
		}
	}
	s.signalScan()
	return Scan{ID: id, SourceID: sourceID, State: "pending", CreatedAt: now}, nil
}

func (s *Store) RetryAcquisitionScan(ctx context.Context, scanID, requestID string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE source_scans SET state='pending',files_visited=0,supported_count=0,epub_count=0,audio_count=0,new_count=0,changed_count=0,unchanged_count=0,missing_count=0,problem_count=0,error_summary='',started_at=NULL,finished_at=NULL WHERE id=? AND acquisition_request_id=? AND state IN ('failed','completed')`, scanID, requestID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return ErrNotFound
	}
	if err := s.saveAcquisitionOutcome(ctx, requestID, scanID, "pending", "", "", ""); err != nil {
		return err
	}
	s.signalScan()
	return nil
}

func (s *Store) Scans(ctx context.Context, actor auth.User, libraryID, sourceID string) ([]Scan, error) {
	if ok, err := s.canScan(ctx, actor, libraryID, sourceID); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,source_id,state,files_visited,supported_count,epub_count,audio_count,new_count,changed_count,unchanged_count,missing_count,problem_count,auto_imported_count,error_summary,created_at,started_at,finished_at FROM source_scans WHERE source_id=? ORDER BY created_at DESC LIMIT 20`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Scan
	for rows.Next() {
		v, err := scanScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) Entries(ctx context.Context, actor auth.User, libraryID, sourceID string) ([]Entry, error) {
	if ok, err := s.canScan(ctx, actor, libraryID, sourceID); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,source_id,relative_path,detected_kind,size_bytes,modified_at,COALESCE(sha256,''),state,metadata_json,path_hints_json,error_summary FROM source_entries WHERE source_id=? ORDER BY relative_path`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var v Entry
		var modified, metadata, pathHints string
		if err := rows.Scan(&v.ID, &v.SourceID, &v.RelativePath, &v.Kind, &v.SizeBytes, &modified, &v.SHA256, &v.State, &metadata, &pathHints, &v.Error); err != nil {
			return nil, err
		}
		v.ModifiedAt, _ = time.Parse(time.RFC3339Nano, modified)
		v.Metadata = json.RawMessage(metadata)
		v.PathHints = json.RawMessage(pathHints)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) scanLoop(ctx context.Context) {
	defer close(s.done)
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
			for {
				job, ok, err := s.claimScan(ctx)
				if err != nil {
					if ctx.Err() != nil {
						return
					}
					slog.Error("claim source scan", "error", err)
					select {
					case <-ctx.Done():
						return
					case <-time.After(time.Second):
						continue
					}
				}
				if !ok {
					break
				}
				if err := s.runScan(ctx, job); err != nil && ctx.Err() == nil {
					if finishErr := s.finishScan(context.Background(), job.ID, "failed", summary{}, bounded(err.Error())); finishErr != nil {
						slog.Error("record failed source scan", "scan_id", job.ID, "error", finishErr)
					}
				}
			}
		}
	}
}
func (s *Store) signalScan() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *Store) claimScan(ctx context.Context) (Scan, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Scan{}, false, err
	}
	defer tx.Rollback()
	var id, sourceID string
	err = tx.QueryRowContext(ctx, `SELECT id,source_id FROM source_scans WHERE state='pending' ORDER BY created_at,id LIMIT 1`).Scan(&id, &sourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return Scan{}, false, nil
	}
	if err != nil {
		return Scan{}, false, err
	}
	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE source_scans SET state='scanning',started_at=? WHERE id=? AND state='pending'`, now.Format(time.RFC3339Nano), id)
	if err != nil {
		return Scan{}, false, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return Scan{}, false, nil
	}
	if err := tx.Commit(); err != nil {
		return Scan{}, false, err
	}
	return Scan{ID: id, SourceID: sourceID, State: "scanning", StartedAt: &now}, true, nil
}

type summary struct{ files, supported, epub, audio, new, changed, unchanged, missing, problems, autoImported int }

func (s *Store) runScan(ctx context.Context, job Scan) error {
	var root, requestID, payloadRelative string
	var enabled int
	err := s.db.QueryRowContext(ctx, `SELECT ls.root_path,ls.enabled,COALESCE(sc.acquisition_request_id,''),COALESCE(ar.completed_relative_path,'') FROM source_scans sc JOIN library_sources ls ON ls.id=sc.source_id LEFT JOIN acquisition_requests ar ON ar.id=sc.acquisition_request_id WHERE sc.id=? AND ls.deleted_at IS NULL`, job.ID).Scan(&root, &enabled, &requestID, &payloadRelative)
	if err != nil || enabled == 0 {
		return ErrUnavailable
	}
	scanRoot := root
	if requestID != "" {
		if payloadRelative == "" || filepath.IsAbs(payloadRelative) {
			return validation("acquisition_payload_unavailable", "The completed acquisition payload was not recorded.")
		}
		scanRoot = filepath.Join(root, filepath.FromSlash(payloadRelative))
		if !within(root, scanRoot) {
			return validation("acquisition_payload_unavailable", "The completed acquisition payload is outside its destination Source.")
		}
		if _, err := os.Stat(scanRoot); err != nil {
			return validation("acquisition_payload_unavailable", "The completed acquisition payload is no longer visible to Aldus.")
		}
	}
	sum := summary{}
	err = filepath.WalkDir(scanRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			sum.problems++
			return nil
		}
		if path == scanRoot && d.IsDir() {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		sum.files++
		ext := strings.ToLower(filepath.Ext(path))
		kind := ""
		if ext == ".epub" {
			kind = "epub"
		} else if audioExtension(ext) {
			kind = "audio"
		} else {
			return nil
		}
		var current int
		if err := s.db.QueryRowContext(ctx, `SELECT enabled FROM library_sources WHERE id=? AND deleted_at IS NULL`, job.SourceID).Scan(&current); err != nil || current == 0 {
			return ErrUnavailable
		}
		relative, err := filepath.Rel(root, path)
		if err != nil || filepath.IsAbs(relative) || strings.HasPrefix(relative, "..") {
			return ErrInvalid
		}
		info, err := d.Info()
		if err != nil || !info.Mode().IsRegular() {
			sum.problems++
			return nil
		}
		if info.Size() > s.maxBytes {
			sum.problems++
			return s.upsertProblem(ctx, job, relative, kind, info, errors.New("file exceeds scan limit"))
		}
		metadata, inspectErr := s.inspect(ctx, path, kind)
		if inspectErr != nil {
			sum.problems++
			return s.upsertProblem(ctx, job, relative, kind, info, inspectErr)
		}
		hash, err := hashPath(ctx, path, s.maxBytes)
		if err != nil {
			sum.problems++
			return s.upsertProblem(ctx, job, relative, kind, info, err)
		}
		classification, err := s.upsertEntry(ctx, job, relative, kind, info, hash, metadata)
		if err != nil {
			return err
		}
		sum.supported++
		if kind == "epub" {
			sum.epub++
		} else {
			sum.audio++
		}
		switch classification {
		case "new":
			sum.new++
		case "changed":
			sum.changed++
		default:
			sum.unchanged++
		}
		return nil
	})
	if err != nil {
		return err
	}
	if requestID == "" {
		result, err := s.db.ExecContext(ctx, `UPDATE source_entries SET state='missing',updated_at=? WHERE source_id=? AND state!='missing' AND (last_seen_scan_id IS NULL OR last_seen_scan_id!=?)`, time.Now().UTC().Format(time.RFC3339Nano), job.SourceID, job.ID)
		if err != nil {
			return err
		}
		missing, _ := result.RowsAffected()
		sum.missing = int(missing)
	}
	var libraryID string
	if err := s.db.QueryRowContext(ctx, `SELECT library_id FROM library_sources WHERE id=?`, job.SourceID).Scan(&libraryID); err != nil {
		return err
	}
	if err := s.GenerateProposals(ctx, libraryID); err != nil {
		return err
	}
	sum.autoImported, err = s.processAcquisitionImport(ctx, libraryID, job.SourceID, job.ID)
	if err != nil {
		return err
	}
	automatic, err := s.autoImportProposals(ctx, libraryID, job.SourceID, job.ID)
	if err != nil {
		return err
	}
	sum.autoImported += automatic
	return s.finishScan(ctx, job.ID, "completed", sum, "")
}

func (s *Store) finishScan(ctx context.Context, id, state string, v summary, message string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `UPDATE source_scans SET state=?,files_visited=?,supported_count=?,epub_count=?,audio_count=?,new_count=?,changed_count=?,unchanged_count=?,missing_count=?,problem_count=?,auto_imported_count=?,error_summary=?,finished_at=? WHERE id=?`, state, v.files, v.supported, v.epub, v.audio, v.new, v.changed, v.unchanged, v.missing, v.problems, v.autoImported, message, now, id)
	if err != nil {
		return err
	}
	if state == "failed" {
		reason := strings.TrimSpace(message)
		if reason == "" {
			reason = "Source scan failed."
		}
		return s.failAcquisitionOutcome(ctx, id, reason)
	}
	return nil
}
func (s *Store) canScan(ctx context.Context, actor auth.User, libraryID, sourceID string) (bool, error) {
	var n int
	args := append([]any{actor.ID, sourceID, libraryID}, auth.LibraryEditArgs(actor)...)
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM library_sources ls LEFT JOIN library_members lm ON lm.library_id=ls.library_id AND lm.user_id=? WHERE ls.id=? AND ls.library_id=? AND ls.deleted_at IS NULL AND `+auth.EffectiveLibraryEditSQL("ls.library_id", "lm"), args...).Scan(&n)
	return n == 1, err
}
func (s *Store) upsertEntry(ctx context.Context, job Scan, relative, kind string, info fs.FileInfo, hash string, metadata map[string]any) (string, error) {
	var oldHash, state string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(sha256,''),state FROM source_entries WHERE source_id=? AND relative_path=?`, job.SourceID, relative).Scan(&oldHash, &state)
	classification := "unchanged"
	id := ""
	if errors.Is(err, sql.ErrNoRows) {
		classification = "new"
		id, err = randomID()
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else if oldHash != hash || state == "missing" {
		classification = "changed"
	}
	meta, _ := json.Marshal(metadata)
	hints, _ := json.Marshal(map[string]any{"basename": strings.TrimSuffix(filepath.Base(relative), filepath.Ext(relative)), "parent": filepath.ToSlash(filepath.Dir(relative)), "components": strings.Split(filepath.ToSlash(relative), "/")})
	device, inode := fileIdentity(info)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,metadata_json,path_hints_json,last_seen_scan_id,error_summary,device,inode) VALUES(?,?,?,?,?,?,'registered',?,?,?,?,?,?, '',?,?) ON CONFLICT(source_id,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,sha256=excluded.sha256,state='registered',updated_at=excluded.updated_at,detected_kind=excluded.detected_kind,metadata_json=excluded.metadata_json,path_hints_json=excluded.path_hints_json,last_seen_scan_id=excluded.last_seen_scan_id,error_summary='',device=excluded.device,inode=excluded.inode`, id, job.SourceID, relative, info.Size(), info.ModTime().UTC().Format(time.RFC3339Nano), hash, now, now, kind, string(meta), string(hints), job.ID, device, inode)
	return classification, err
}
func (s *Store) upsertProblem(ctx context.Context, job Scan, relative, kind string, info fs.FileInfo, cause error) error {
	id, err := randomID()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,state,created_at,updated_at,detected_kind,last_seen_scan_id,error_summary) VALUES(?,?,?,?,?,'error',?,?,?,?,?) ON CONFLICT(source_id,relative_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_at=excluded.modified_at,state='error',updated_at=excluded.updated_at,detected_kind=excluded.detected_kind,last_seen_scan_id=excluded.last_seen_scan_id,error_summary=excluded.error_summary`, id, job.SourceID, relative, info.Size(), info.ModTime().UTC().Format(time.RFC3339Nano), now, now, kind, job.ID, bounded(cause.Error()))
	return err
}
func hashPath(ctx context.Context, path string, max int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	buffer := make([]byte, 128<<10)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, err := f.Read(buffer)
		total += int64(n)
		if total > max {
			return "", errors.New("file exceeds scan limit")
		}
		if n > 0 {
			h.Write(buffer[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func audioExtension(ext string) bool {
	switch ext {
	case ".mp3", ".m4a", ".m4b", ".aac", ".flac", ".ogg", ".opus", ".wav":
		return true
	}
	return false
}
func bounded(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 500 {
		return value[:500]
	}
	return value
}
func fileIdentity(info fs.FileInfo) (any, any) {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return int64(stat.Dev), int64(stat.Ino)
	}
	return nil, nil
}

func (s *Store) inspect(ctx context.Context, path, kind string) (map[string]any, error) {
	if kind == "epub" {
		return inspectEPUB(path, s.maxBytes)
	}
	probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return inspectAudio(probeCtx, path)
}
func inspectEPUB(path string, max int64) (map[string]any, error) {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer archive.Close()
	if len(archive.File) == 0 || len(archive.File) > 10000 {
		return nil, errors.New("invalid EPUB entry count")
	}
	files := map[string]*zip.File{}
	var total uint64
	for _, entry := range archive.File {
		total += entry.UncompressedSize64
		if total > uint64(max) {
			return nil, errors.New("EPUB expands beyond limit")
		}
		name := filepath.ToSlash(filepath.Clean(entry.Name))
		if strings.HasPrefix(name, "../") || strings.HasPrefix(name, "/") {
			return nil, errors.New("unsafe EPUB entry")
		}
		files[name] = entry
	}
	mime := files["mimetype"]
	if mime == nil {
		return nil, errors.New("missing EPUB mimetype")
	}
	b, err := readZip(mime, 101)
	if err != nil || string(b) != "application/epub+zip" {
		return nil, errors.New("invalid EPUB mimetype")
	}
	var container struct {
		Rootfiles []struct {
			Path string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := decodeZip(files["META-INF/container.xml"], &container); err != nil || len(container.Rootfiles) == 0 {
		return nil, errors.New("invalid EPUB container")
	}
	var pkg struct {
		Title       string   `xml:"metadata>title"`
		Creators    []string `xml:"metadata>creator"`
		Language    string   `xml:"metadata>language"`
		Identifiers []string `xml:"metadata>identifier"`
		Publisher   string   `xml:"metadata>publisher"`
		Date        string   `xml:"metadata>date"`
		Items       []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			Type       string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"manifest>item"`
		Refs []struct {
			ID string `xml:"idref,attr"`
		} `xml:"spine>itemref"`
		Meta []struct {
			Name     string `xml:"name,attr"`
			Property string `xml:"property,attr"`
			Content  string `xml:"content,attr"`
			Value    string `xml:",chardata"`
		} `xml:"metadata>meta"`
	}
	opf := files[filepath.ToSlash(filepath.Clean(container.Rootfiles[0].Path))]
	if err := decodeZip(opf, &pkg); err != nil || len(pkg.Items) == 0 || len(pkg.Refs) == 0 {
		return nil, errors.New("invalid EPUB package or spine")
	}
	out := map[string]any{"title": strings.TrimSpace(pkg.Title), "creators": pkg.Creators, "language": strings.TrimSpace(pkg.Language), "identifiers": pkg.Identifiers, "publisher": strings.TrimSpace(pkg.Publisher), "date": strings.TrimSpace(pkg.Date)}
	coverID := ""
	for _, m := range pkg.Meta {
		key := m.Name
		if key == "" {
			key = m.Property
		}
		if key == "calibre:series" || key == "belongs-to-collection" {
			value := strings.TrimSpace(first(m.Content, m.Value))
			if previous, ok := out["series"].(string); ok && previous != value {
				out["series_conflict"] = true
			}
			out["series"] = value
		}
		if key == "calibre:series_index" || key == "group-position" {
			value := strings.TrimSpace(first(m.Content, m.Value))
			if previous, ok := out["series_index"].(string); ok && previous != value {
				out["series_conflict"] = true
			}
			out["series_index"] = value
		}
		if m.Name == "cover" {
			coverID = m.Content
		}
	}
	for _, item := range pkg.Items {
		if item.ID != coverID && !strings.Contains(" "+item.Properties+" ", " cover-image ") {
			continue
		}
		name := filepath.ToSlash(filepath.Clean(filepath.Join(filepath.Dir(container.Rootfiles[0].Path), item.Href)))
		if files[name] != nil && (item.Type == "image/jpeg" || item.Type == "image/png") {
			out["has_cover"] = true
			break
		}
	}
	return out, nil
}
func inspectAudio(ctx context.Context, path string) (map[string]any, error) {
	output, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration:format_tags=title,artist,album,album_artist,composer,narrator,series,track,disc,date,publisher", "-of", "json", path).Output()
	if err != nil {
		return nil, err
	}
	var result struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
		} `json:"streams"`
		Format struct {
			Duration string            `json:"duration"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
	}
	if json.Unmarshal(output, &result) != nil || len(result.Streams) == 0 || result.Streams[0].CodecType != "audio" {
		return nil, errors.New("no audio stream")
	}
	duration, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil || duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return nil, errors.New("invalid audio duration")
	}
	return map[string]any{"duration_ms": int64(duration * 1000), "tags": result.Format.Tags}, nil
}
func readZip(file *zip.File, max int64) ([]byte, error) {
	if file == nil || int64(file.UncompressedSize64) > max {
		return nil, errors.New("ZIP entry too large")
	}
	r, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r, max+1))
}
func decodeZip(file *zip.File, value any) error {
	b, err := readZip(file, 8<<20)
	if err != nil {
		return err
	}
	return xml.Unmarshal(b, value)
}
func first(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

type rowScanner interface{ Scan(...any) error }

func scanScan(row rowScanner) (Scan, error) {
	var v Scan
	var created string
	var started, finished sql.NullString
	err := row.Scan(&v.ID, &v.SourceID, &v.State, &v.FilesVisited, &v.Supported, &v.EPUB, &v.Audio, &v.New, &v.Changed, &v.Unchanged, &v.Missing, &v.Problems, &v.AutoImported, &v.Error, &created, &started, &finished)
	v.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	if started.Valid {
		t, _ := time.Parse(time.RFC3339Nano, started.String)
		v.StartedAt = &t
	}
	if finished.Valid {
		t, _ := time.Parse(time.RFC3339Nano, finished.String)
		v.FinishedAt = &t
	}
	return v, err
}
