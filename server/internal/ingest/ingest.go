package ingest

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

var (
	ErrNotFound = errors.New("media target not found")
	ErrInvalid  = errors.New("invalid media")
	ErrTooLarge = errors.New("media exceeds size limit")
)

type Options struct {
	Root     string
	MaxBytes int64
	Probe    func(context.Context, string) error
	Resolver *source.Store
}

type Store struct {
	db       *sql.DB
	root     string
	maxBytes int64
	probe    func(context.Context, string) error
	resolver *source.Store
	mu       sync.Mutex
	probes   chan struct{}
}

type Media struct {
	ID               string    `json:"id"`
	RepresentationID string    `json:"representation_id"`
	Kind             string    `json:"kind"`
	SHA256           string    `json:"sha256"`
	OriginalFilename string    `json:"original_filename,omitempty"`
	SizeBytes        int64     `json:"size_bytes"`
	CreatedAt        time.Time `json:"created_at"`
}

type AudioChapter struct {
	Title   string `json:"title"`
	StartMS int64  `json:"start_ms"`
	EndMS   int64  `json:"end_ms"`
}

func (s *Store) MaxBytes() int64 { return s.maxBytes }

func New(db *sql.DB, options Options) (*Store, error) {
	if options.Root == "" {
		return nil, errors.New("media root is required")
	}
	if options.MaxBytes <= 0 {
		return nil, errors.New("positive media size limit is required")
	}
	root, err := filepath.Abs(options.Root)
	if err != nil {
		return nil, fmt.Errorf("resolve media root: %w", err)
	}
	for _, dir := range []string{filepath.Join(root, "staging"), filepath.Join(root, "media")} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("create media directory: %w", err)
		}
	}
	entries, err := os.ReadDir(filepath.Join(root, "staging"))
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			if err := os.Remove(filepath.Join(root, "staging", entry.Name())); err != nil {
				return nil, fmt.Errorf("clean staging: %w", err)
			}
		}
	}
	probe := options.Probe
	if probe == nil {
		probe = ffprobe
	}
	resolver := options.Resolver
	if resolver == nil {
		resolver, err = source.New(db, source.Options{ManagedRoot: root})
		if err != nil {
			return nil, err
		}
	}
	return &Store{db: db, root: root, maxBytes: options.MaxBytes, probe: probe, resolver: resolver, probes: make(chan struct{}, 2)}, nil
}

func (s *Store) Upload(ctx context.Context, actor auth.User, libraryID, representationID, filename string, source io.Reader) (Media, error) {
	kind, ok, err := s.editableRepresentation(ctx, actor, libraryID, representationID)
	if err != nil {
		return Media{}, err
	}
	if !ok {
		return Media{}, ErrNotFound
	}
	if kind != "epub" && kind != "audio" && kind != "audiobook" {
		return Media{}, ErrInvalid
	}
	staged, err := os.CreateTemp(filepath.Join(s.root, "staging"), "upload-")
	if err != nil {
		return Media{}, fmt.Errorf("create staging file: %w", err)
	}
	stagedPath := staged.Name()
	keep := false
	defer func() {
		staged.Close()
		if !keep {
			os.Remove(stagedPath)
		}
	}()
	hash := sha256.New()
	limited := &io.LimitedReader{R: source, N: s.maxBytes + 1}
	written, err := io.Copy(io.MultiWriter(staged, hash), limited)
	if err != nil {
		return Media{}, fmt.Errorf("stream media: %w", err)
	}
	if written > s.maxBytes {
		return Media{}, ErrTooLarge
	}
	if err := ctx.Err(); err != nil {
		return Media{}, err
	}
	if err := staged.Sync(); err != nil {
		return Media{}, fmt.Errorf("sync staged media: %w", err)
	}
	if err := staged.Close(); err != nil {
		return Media{}, fmt.Errorf("close staged media: %w", err)
	}
	if kind == "epub" {
		err = validateEPUB(stagedPath, s.maxBytes)
	} else {
		probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err = s.probe(probeCtx, stagedPath)
		cancel()
	}
	if err != nil {
		return Media{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	extension := ".audio"
	if kind == "epub" {
		extension = ".epub"
	}
	relative := filepath.Join(digest[:2], digest+extension)
	final := filepath.Join(s.root, "media", relative)
	name := filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	if name == "." || name == "/" {
		name = ""
	}
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	if runes := []rune(name); len(runes) > 255 {
		name = string(runes[:255])
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, found, err := s.existing(ctx, representationID, digest); err != nil {
		return Media{}, err
	} else if found {
		return existing, nil
	}
	if err := os.MkdirAll(filepath.Dir(final), 0o750); err != nil {
		return Media{}, err
	}
	created := false
	if info, err := os.Lstat(final); errors.Is(err, os.ErrNotExist) {
		if err := os.Rename(stagedPath, final); err != nil {
			return Media{}, fmt.Errorf("finalize media: %w", err)
		}
		created = true
		keep = true
	} else if err != nil {
		return Media{}, err
	} else if !info.Mode().IsRegular() {
		return Media{}, ErrInvalid
	}
	id, err := randomID()
	if err != nil {
		if created {
			os.Remove(final)
		}
		return Media{}, err
	}
	now := time.Now().UTC()
	media := Media{ID: id, RepresentationID: representationID, Kind: kind, SHA256: digest, OriginalFilename: name, SizeBytes: written, CreatedAt: now}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		if created {
			os.Remove(final)
		}
		return Media{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes) VALUES(?,?,?,?,?,?,?,?)`, id, representationID, kind, relative, digest, now.Format(time.RFC3339Nano), name, written)
	if err != nil {
		if created {
			os.Remove(final)
		}
		return Media{}, fmt.Errorf("record media: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alignments SET state='stale' WHERE state!='stale' AND EXISTS(SELECT 1 FROM alignment_inputs ai JOIN media old ON old.id=ai.media_id WHERE ai.alignment_id=alignments.id AND old.representation_id=? AND old.id!=?)`, representationID, id); err != nil {
		if created {
			os.Remove(final)
		}
		return Media{}, fmt.Errorf("stale prior alignments: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alignment_jobs SET state='stale',finished_at=? WHERE state='ready' AND alignment_id IN (SELECT a.id FROM alignments a WHERE a.state='stale')`, now.Format(time.RFC3339Nano)); err != nil {
		if created {
			os.Remove(final)
		}
		return Media{}, fmt.Errorf("stale prior jobs: %w", err)
	}
	if err := tx.Commit(); err != nil {
		if created {
			os.Remove(final)
		}
		return Media{}, fmt.Errorf("commit media: %w", err)
	}
	return media, nil
}

func (s *Store) Media(ctx context.Context, actor auth.User, libraryID, representationID string, limit, offset int) ([]Media, error) {
	if ok, err := s.readableRepresentation(ctx, actor, libraryID, representationID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotFound
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,representation_id,kind,sha256,original_filename,size_bytes,created_at FROM media WHERE representation_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?`, representationID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Media
	for rows.Next() {
		var m Media
		var created string
		if err := rows.Scan(&m.ID, &m.RepresentationID, &m.Kind, &m.SHA256, &m.OriginalFilename, &m.SizeBytes, &created); err != nil {
			return nil, err
		}
		m.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) Open(ctx context.Context, actor auth.User, id string) (*os.File, Media, error) {
	var m Media
	var created string
	err := s.db.QueryRowContext(ctx, `SELECT md.id,md.representation_id,md.kind,md.sha256,md.original_filename,md.size_bytes,md.created_at FROM media md JOIN representations r ON r.id=md.representation_id JOIN works w ON w.id=r.work_id WHERE md.id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), append([]any{id}, auth.LibraryAccessArgs(actor)...)...).Scan(&m.ID, &m.RepresentationID, &m.Kind, &m.SHA256, &m.OriginalFilename, &m.SizeBytes, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, Media{}, ErrNotFound
	}
	if err != nil {
		return nil, Media{}, err
	}
	m.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	file, err := s.resolver.OpenMedia(ctx, id, false)
	if errors.Is(err, source.ErrUnavailable) || errors.Is(err, source.ErrInvalid) {
		return nil, Media{}, ErrNotFound
	}
	return file, m, err
}

func (s *Store) AudioChapters(ctx context.Context, actor auth.User, id string) ([]AudioChapter, error) {
	file, media, err := s.Open(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if media.Kind != "audio" && media.Kind != "audiobook" {
		return nil, ErrInvalid
	}
	select {
	case s.probes <- struct{}{}:
		defer func() { <-s.probes }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var output boundedBuffer
	output.remaining = 1 << 20
	command := exec.CommandContext(probeCtx, "ffprobe", "-v", "error", "-show_entries", "chapter=start_time,end_time:chapter_tags=title:format=duration", "-of", "json", file.Name())
	command.Stdout = &output
	err = command.Run()
	if err != nil {
		return nil, fmt.Errorf("probe audio chapters: %w", err)
	}
	if output.truncated {
		return nil, fmt.Errorf("%w: chapter metadata too large", ErrInvalid)
	}
	chapters, err := parseAudioChapters(output.Bytes(), media.OriginalFilename)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return chapters, nil
}

type boundedBuffer struct {
	bytes.Buffer
	remaining int
	truncated bool
}

func (b *boundedBuffer) Write(value []byte) (int, error) {
	length := len(value)
	if length > b.remaining {
		value = value[:b.remaining]
		b.truncated = true
	}
	_, _ = b.Buffer.Write(value)
	b.remaining -= len(value)
	return length, nil
}

func parseAudioChapters(data []byte, filename string) ([]AudioChapter, error) {
	var result struct {
		Chapters []struct {
			Start string `json:"start_time"`
			End   string `json:"end_time"`
			Tags  struct {
				Title string `json:"title"`
			} `json:"tags"`
		} `json:"chapters"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, errors.New("invalid ffprobe output")
	}
	duration, err := secondsToMilliseconds(result.Format.Duration)
	if err != nil {
		return nil, errors.New("invalid audio duration")
	}
	if len(result.Chapters) == 0 {
		title := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
		if strings.TrimSpace(title) == "" {
			title = "Audiobook"
		}
		return []AudioChapter{{Title: title, EndMS: duration}}, nil
	}
	chapters := make([]AudioChapter, 0, len(result.Chapters))
	for i, value := range result.Chapters {
		start, startErr := secondsToMilliseconds(value.Start)
		end, endErr := secondsToMilliseconds(value.End)
		if startErr != nil || endErr != nil || start < 0 || end <= start || end > duration {
			return nil, errors.New("invalid audio chapter boundary")
		}
		if i > 0 && start < chapters[i-1].EndMS {
			return nil, errors.New("overlapping audio chapters")
		}
		title := strings.TrimSpace(value.Tags.Title)
		if title == "" {
			title = fmt.Sprintf("Chapter %d", i+1)
		}
		chapters = append(chapters, AudioChapter{Title: title, StartMS: start, EndMS: end})
	}
	return chapters, nil
}

func secondsToMilliseconds(value string) (int64, error) {
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || seconds < 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, errors.New("invalid duration")
	}
	return int64(math.Round(seconds * 1000)), nil
}

func (s *Store) editableRepresentation(ctx context.Context, actor auth.User, libraryID, id string) (string, bool, error) {
	var kind string
	err := s.db.QueryRowContext(ctx, `SELECT r.kind FROM representations r JOIN works w ON w.id=r.work_id LEFT JOIN library_members m ON m.library_id=w.library_id AND m.user_id=? WHERE r.id=? AND w.library_id=? AND (? OR m.role IN ('owner','editor'))`, actor.ID, id, libraryID, actor.Admin).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return kind, err == nil, err
}
func (s *Store) readableRepresentation(ctx context.Context, actor auth.User, libraryID, id string) (bool, error) {
	var n int
	args := []any{id, libraryID}
	args = append(args, auth.LibraryAccessArgs(actor)...)
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM representations r JOIN works w ON w.id=r.work_id WHERE r.id=? AND w.library_id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), args...).Scan(&n)
	return n == 1, err
}
func (s *Store) existing(ctx context.Context, representationID, hash string) (Media, bool, error) {
	var m Media
	var created string
	err := s.db.QueryRowContext(ctx, `SELECT id,representation_id,kind,sha256,original_filename,size_bytes,created_at FROM media WHERE representation_id=? AND sha256=?`, representationID, hash).Scan(&m.ID, &m.RepresentationID, &m.Kind, &m.SHA256, &m.OriginalFilename, &m.SizeBytes, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Media{}, false, nil
	}
	if err != nil {
		return Media{}, false, err
	}
	m.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	return m, true, nil
}
func randomID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func validateEPUB(path string, max int64) error {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer archive.Close()
	if len(archive.File) == 0 || len(archive.File) > 10000 {
		return errors.New("invalid EPUB entry count")
	}
	var total uint64
	names := make(map[string]*zip.File, len(archive.File))
	for _, entry := range archive.File {
		total += entry.UncompressedSize64
		if total > uint64(max) {
			return errors.New("EPUB expands beyond limit")
		}
		clean := filepath.ToSlash(filepath.Clean(entry.Name))
		if strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
			return errors.New("unsafe EPUB entry")
		}
		names[clean] = entry
	}
	mimetype := names["mimetype"]
	if mimetype == nil || mimetype.UncompressedSize64 > 100 {
		return errors.New("missing EPUB mimetype")
	}
	reader, err := mimetype.Open()
	if err != nil {
		return err
	}
	value, err := io.ReadAll(io.LimitReader(reader, 101))
	reader.Close()
	if err != nil || string(value) != "application/epub+zip" {
		return errors.New("invalid EPUB mimetype")
	}
	container := names["META-INF/container.xml"]
	if container == nil {
		return errors.New("missing EPUB container")
	}
	var doc struct {
		Rootfiles []struct {
			Path string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := decodeXML(container, &doc); err != nil || len(doc.Rootfiles) == 0 {
		return errors.New("invalid EPUB container")
	}
	opf := names[filepath.ToSlash(filepath.Clean(doc.Rootfiles[0].Path))]
	if opf == nil {
		return errors.New("missing EPUB package")
	}
	var pkg struct {
		Items []struct {
			ID string `xml:"id,attr"`
		} `xml:"manifest>item"`
		Refs []struct {
			ID string `xml:"idref,attr"`
		} `xml:"spine>itemref"`
	}
	if err := decodeXML(opf, &pkg); err != nil || len(pkg.Items) == 0 || len(pkg.Refs) == 0 {
		return errors.New("invalid EPUB package or spine")
	}
	return nil
}
func decodeXML(file *zip.File, value any) error {
	if file.UncompressedSize64 > 8<<20 {
		return errors.New("XML entry too large")
	}
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	return xml.NewDecoder(io.LimitReader(reader, 8<<20)).Decode(value)
}
func ffprobe(ctx context.Context, path string) error {
	output, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json", path).Output()
	if err != nil {
		return err
	}
	var result struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(output, &result) != nil || len(result.Streams) == 0 || result.Streams[0].CodecType != "audio" {
		return errors.New("no finite audio stream")
	}
	duration, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil || duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return errors.New("no finite audio stream")
	}
	return nil
}
