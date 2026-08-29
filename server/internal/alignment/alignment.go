package alignment

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	dbsql "github.com/mahcks/aldus/server/internal/database/sqlc"
	"github.com/mahcks/aldus/server/internal/position"
	"github.com/mahcks/aldus/server/internal/source"
)

const ContractVersion = 1
const maxArtifactBytes = 64 << 20

var (
	ErrNotFound = errors.New("alignment job not found")
	ErrInvalid  = errors.New("invalid alignment request")
	ErrCanceled = errors.New("alignment canceled")
)

type Options struct {
	MediaRoot     string
	ArtifactRoot  string
	Command       []string
	Timeout       time.Duration
	WorkerVersion string
	Model         string
	ModelRoot     string
	AudioDuration func(context.Context, string) (int64, error)
	Media         *source.Store
}

type Manager struct {
	db      *sql.DB
	queries *dbsql.Queries
	options Options
	wake    chan struct{}
	mu      sync.Mutex
	cancel  map[string]context.CancelFunc
	done    chan struct{}
	media   *source.Store
}

type Request struct {
	EPUBMediaID  string `json:"epub_media_id"`
	EPUBSHA256   string `json:"epub_sha256"`
	AudioMediaID string `json:"audio_media_id"`
	AudioSHA256  string `json:"audio_sha256"`
}

type Job struct {
	ID            string     `json:"id"`
	AlignmentID   string     `json:"alignment_id,omitempty"`
	EPUBMediaID   string     `json:"epub_media_id"`
	AudioMediaID  string     `json:"audio_media_id"`
	State         string     `json:"state"`
	Attempts      int        `json:"attempts"`
	WorkerVersion string     `json:"worker_version"`
	Model         string     `json:"model"`
	ArtifactID    string     `json:"artifact_id,omitempty"`
	Error         string     `json:"error,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
}

type Artifact struct {
	Version     int       `json:"version"`
	Tool        string    `json:"tool"`
	Model       string    `json:"model"`
	EPUBSHA256  string    `json:"epub_sha256"`
	AudioSHA256 string    `json:"audio_sha256"`
	Segments    []Segment `json:"segments"`
}

type Segment struct {
	ID             string `json:"id"`
	Ordinal        int    `json:"ordinal"`
	Text           string `json:"text"`
	NormalizedText string `json:"normalized_text"`
	EPUB           struct {
		Href    string          `json:"href"`
		DOMPath string          `json:"dom_path"`
		Locator json.RawMessage `json:"locator"`
	} `json:"epub"`
	Audio struct {
		Resource string `json:"resource"`
		StartMS  int64  `json:"start_ms"`
		EndMS    int64  `json:"end_ms"`
	} `json:"audio"`
	Status        string          `json:"status"`
	Highlightable bool            `json:"highlightable"`
	Confidence    json.RawMessage `json:"confidence_signals"`
	WordTimings   json.RawMessage `json:"word_timings"`
}

type workerInput struct {
	Version            int            `json:"version"`
	EPUBPath           string         `json:"epub_path"`
	AudioPath          string         `json:"audio_path"`
	EPUBSHA256         string         `json:"epub_sha256"`
	AudioSHA256        string         `json:"audio_sha256"`
	AudioResource      string         `json:"audio_resource"`
	AudioDuration      int64          `json:"audio_duration_ms"`
	Model              string         `json:"model"`
	KOReaderDocumentID string         `json:"-"`
	Segments           []inputSegment `json:"segments"`
}

type inputSegment struct {
	ID              string `json:"id"`
	Ordinal         int    `json:"ordinal"`
	Text            string `json:"text"`
	KOReaderLocator string `json:"-"`
	Href            string `json:"href"`
	DOMPath         string `json:"dom_path"`
}

func New(db *sql.DB, o Options) (*Manager, error) {
	if len(o.Command) == 0 || o.MediaRoot == "" || o.ArtifactRoot == "" || o.Timeout <= 0 {
		return nil, ErrInvalid
	}
	if o.WorkerVersion == "" {
		o.WorkerVersion = "whisperx 3.8.6"
	}
	if o.Model == "" {
		o.Model = "base.en"
	}
	if o.AudioDuration == nil {
		o.AudioDuration = audioDuration
	}
	if o.ModelRoot == "" {
		o.ModelRoot = filepath.Join(o.ArtifactRoot, "models")
	}
	for _, d := range []string{o.ArtifactRoot, o.ModelRoot, filepath.Join(o.ArtifactRoot, "matplotlib")} {
		if err := os.MkdirAll(d, 0o750); err != nil {
			return nil, err
		}
	}
	media := o.Media
	if media == nil {
		var err error
		media, err = source.New(db, source.Options{ManagedRoot: o.MediaRoot})
		if err != nil {
			return nil, err
		}
	}
	return &Manager{db: db, queries: dbsql.New(db), options: o, wake: make(chan struct{}, 1), cancel: map[string]context.CancelFunc{}, done: make(chan struct{}), media: media}, nil
}
func (m *Manager) Start(ctx context.Context) error {
	if err := m.recover(ctx); err != nil {
		return err
	}
	go m.loop(ctx)
	m.signal()
	return nil
}
func (m *Manager) Wait() {
	<-m.done
}

// BackfillKOReader upgrades ready alignments created before KOReader locators
// were published. It leaves incompatible historical alignments untouched.
func (m *Manager) BackfillKOReader(ctx context.Context) (updated, skipped int, err error) {
	rows, err := m.db.QueryContext(ctx, `SELECT DISTINCT a.id,a.epub_media_id FROM alignments a JOIN alignment_segments s ON s.alignment_id=a.id WHERE a.state='ready'`)
	if err != nil {
		return 0, 0, err
	}
	type target struct{ alignmentID, mediaID string }
	var targets []target
	for rows.Next() {
		var value target
		if err := rows.Scan(&value.alignmentID, &value.mediaID); err != nil {
			rows.Close()
			return 0, 0, err
		}
		targets = append(targets, value)
	}
	if err := rows.Close(); err != nil {
		return 0, 0, err
	}
	for _, target := range targets {
		ok, err := m.backfillKOReaderAlignment(ctx, target.alignmentID, target.mediaID)
		if err != nil {
			return updated, skipped, err
		}
		if ok {
			updated++
		} else {
			skipped++
		}
	}
	return updated, skipped, nil
}

func (m *Manager) backfillKOReaderAlignment(ctx context.Context, alignmentID, mediaID string) (bool, error) {
	file, err := m.media.OpenMedia(ctx, mediaID, true)
	if err != nil {
		return false, nil
	}
	defer file.Close()
	book, err := position.ImportEPUB(file.Name())
	if err != nil {
		return false, nil
	}
	documentID, err := position.KOReaderPartialMD5(file)
	if err != nil {
		return false, err
	}
	paragraphs := make(map[string]position.EPUBParagraph, len(book.Paragraphs))
	for _, paragraph := range book.Paragraphs {
		paragraphs[paragraph.Href+"\x00"+paragraph.DOMPath] = paragraph
	}
	rows, err := m.db.QueryContext(ctx, `SELECT id,epub_href,json_extract(epub_locator,'$.dom_path'),text FROM alignment_segments WHERE alignment_id=? ORDER BY ordinal`, alignmentID)
	if err != nil {
		return false, err
	}
	locators := map[string]string{}
	for rows.Next() {
		var id, href, text string
		var path sql.NullString
		if err := rows.Scan(&id, &href, &path, &text); err != nil {
			rows.Close()
			return false, err
		}
		paragraph, ok := paragraphs[href+"\x00"+path.String]
		if !path.Valid || !ok || strings.Join(strings.Fields(text), " ") != paragraph.Text {
			rows.Close()
			return false, nil
		}
		locators[id] = position.MarshalKOReaderParagraph(paragraph)
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	for id, locator := range locators {
		if _, err := tx.ExecContext(ctx, `UPDATE alignment_segments SET koreader_locator=? WHERE alignment_id=? AND id=?`, locator, alignmentID, id); err != nil {
			return false, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO koreader_aliases(document_id,media_id) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET media_id=excluded.media_id WHERE (SELECT representation_id FROM media WHERE id=koreader_aliases.media_id)=(SELECT representation_id FROM media WHERE id=excluded.media_id)`, documentID, mediaID); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (m *Manager) recover(ctx context.Context) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := m.db.ExecContext(ctx, `UPDATE alignment_jobs SET state=CASE WHEN attempts<2 THEN 'pending' ELSE 'failed' END,error_summary=CASE WHEN attempts<2 THEN '' ELSE 'worker interrupted twice' END,finished_at=CASE WHEN attempts<2 THEN NULL ELSE ? END WHERE state='processing'`, now)
	return err
}
func (m *Manager) loop(ctx context.Context) {
	defer close(m.done)
	for {
		select {
		case <-ctx.Done():
			m.stopAll()
			return
		case <-m.wake:
			for {
				job, ok, err := m.claim(ctx)
				if err != nil {
					slog.Error("claim alignment job", "error", err)
					break
				}
				if !ok {
					break
				}
				m.run(ctx, job)
			}
		}
	}
}
func (m *Manager) signal() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}
func (m *Manager) stopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, cancel := range m.cancel {
		cancel()
	}
}

func (m *Manager) Enqueue(ctx context.Context, actor auth.User, r Request) (Job, error) {
	var work1, work2, kind1, kind2, hash1, hash2 string
	query := `SELECT w.id,md.kind,md.sha256 FROM media md JOIN representations rp ON rp.id=md.representation_id JOIN works w ON w.id=rp.work_id LEFT JOIN library_members lm ON lm.library_id=w.library_id AND lm.user_id=? WHERE md.id=? AND (? OR lm.role IN ('owner','editor'))`
	if err := m.db.QueryRowContext(ctx, query, actor.ID, r.EPUBMediaID, actor.Admin).Scan(&work1, &kind1, &hash1); errors.Is(err, sql.ErrNoRows) {
		return Job{}, ErrNotFound
	} else if err != nil {
		return Job{}, err
	}
	if err := m.db.QueryRowContext(ctx, query, actor.ID, r.AudioMediaID, actor.Admin).Scan(&work2, &kind2, &hash2); errors.Is(err, sql.ErrNoRows) {
		return Job{}, ErrNotFound
	} else if err != nil {
		return Job{}, err
	}
	if work1 != work2 || kind1 != "epub" || (kind2 != "audio" && kind2 != "audiobook") || hash1 != r.EPUBSHA256 || hash2 != r.AudioSHA256 {
		return Job{}, ErrInvalid
	}
	if job, ok, err := m.findDuplicate(ctx, r); err != nil {
		return Job{}, err
	} else if ok {
		if job.State == "failed" || job.State == "stale" {
			now := time.Now().UTC().Format(time.RFC3339Nano)
			result, updateErr := m.db.ExecContext(ctx, `UPDATE alignment_jobs SET alignment_id=NULL,state='pending',attempts=0,cancel_requested=0,artifact_id=NULL,error_summary='',created_at=?,started_at=NULL,finished_at=NULL WHERE id=? AND state IN ('failed','stale')`, now, job.ID)
			if updateErr != nil {
				return Job{}, updateErr
			}
			if updated, _ := result.RowsAffected(); updated == 1 {
				m.signal()
				return m.Job(ctx, actor, job.ID)
			}
			return m.Job(ctx, actor, job.ID)
		}
		return job, nil
	}
	id, err := randomID()
	if err != nil {
		return Job{}, err
	}
	now := time.Now().UTC()
	_, err = m.db.ExecContext(ctx, `INSERT INTO alignment_jobs(id,epub_media_id,audio_media_id,state,worker_version,model,created_at) VALUES(?,?,?,'pending',?,?,?)`, id, r.EPUBMediaID, r.AudioMediaID, m.options.WorkerVersion, m.options.Model, now.Format(time.RFC3339Nano))
	if err != nil {
		if job, ok, e := m.findDuplicate(ctx, r); e == nil && ok {
			return job, nil
		}
		return Job{}, err
	}
	m.signal()
	return m.Job(ctx, actor, id)
}
func (m *Manager) findDuplicate(ctx context.Context, r Request) (Job, bool, error) {
	job, err := m.scanJob(m.db.QueryRowContext(ctx, `SELECT id,COALESCE(alignment_id,''),epub_media_id,audio_media_id,state,attempts,worker_version,model,COALESCE(artifact_id,''),error_summary,created_at,started_at,finished_at FROM alignment_jobs WHERE epub_media_id=? AND audio_media_id=? AND worker_version=? AND model=?`, r.EPUBMediaID, r.AudioMediaID, m.options.WorkerVersion, m.options.Model))
	if errors.Is(err, sql.ErrNoRows) {
		return Job{}, false, nil
	}
	return job, err == nil, err
}
func (m *Manager) Job(ctx context.Context, actor auth.User, id string) (Job, error) {
	row := m.db.QueryRowContext(ctx, `SELECT j.id,COALESCE(j.alignment_id,''),j.epub_media_id,j.audio_media_id,j.state,j.attempts,j.worker_version,j.model,COALESCE(j.artifact_id,''),j.error_summary,j.created_at,j.started_at,j.finished_at FROM alignment_jobs j JOIN media md ON md.id=j.epub_media_id JOIN representations rp ON rp.id=md.representation_id JOIN works w ON w.id=rp.work_id WHERE j.id=? AND `+auth.EffectiveLibraryAccessSQL("w.library_id"), append([]any{id}, auth.LibraryAccessArgs(actor)...)...)
	job, err := m.scanJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Job{}, ErrNotFound
	}
	return job, err
}

func (m *Manager) Jobs(ctx context.Context, workID string, limit, offset int) ([]Job, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := m.queries.ListAlignmentJobsForWork(ctx, dbsql.ListAlignmentJobsForWorkParams{WorkID: workID, Limit: int64(limit), Offset: int64(offset)})
	if err != nil {
		return nil, fmt.Errorf("list alignment jobs: %w", err)
	}
	jobs := make([]Job, len(rows))
	for i, row := range rows {
		job := Job{ID: row.ID, AlignmentID: row.AlignmentID, EPUBMediaID: row.EpubMediaID, AudioMediaID: row.AudioMediaID, State: row.State, Attempts: int(row.Attempts), WorkerVersion: row.WorkerVersion, Model: row.Model, ArtifactID: row.ArtifactID, Error: row.ErrorSummary}
		job.CreatedAt, _ = time.Parse(time.RFC3339Nano, row.CreatedAt)
		if row.StartedAt.Valid {
			value, _ := time.Parse(time.RFC3339Nano, row.StartedAt.String)
			job.StartedAt = &value
		}
		if row.FinishedAt.Valid {
			value, _ := time.Parse(time.RFC3339Nano, row.FinishedAt.String)
			job.FinishedAt = &value
		}
		jobs[i] = job
	}
	return jobs, nil
}

func (m *Manager) Cancel(ctx context.Context, actor auth.User, id string) error {
	job, err := m.Job(ctx, actor, id)
	if err != nil {
		return err
	}
	var allowed int
	if actor.Admin {
		allowed = 1
	} else {
		var err error
		allowed, err = m.canCancel(ctx, actor.ID, id)
		if err != nil {
			return err
		}
	}
	if allowed != 1 {
		return ErrNotFound
	}
	if job.State == "ready" || job.State == "failed" || job.State == "stale" {
		return ErrInvalid
	}
	_, err = m.db.ExecContext(ctx, `UPDATE alignment_jobs SET cancel_requested=1,state=CASE WHEN state='pending' THEN 'failed' ELSE state END,error_summary=CASE WHEN state='pending' THEN 'canceled' ELSE error_summary END,finished_at=CASE WHEN state='pending' THEN ? ELSE finished_at END WHERE id=?`, time.Now().UTC().Format(time.RFC3339Nano), id)
	m.mu.Lock()
	cancel := m.cancel[id]
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return err
}

func (m *Manager) canCancel(ctx context.Context, userID, id string) (int, error) {
	var allowed int
	if err := m.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM alignment_jobs j JOIN media md ON md.id=j.epub_media_id JOIN representations rp ON rp.id=md.representation_id JOIN works w ON w.id=rp.work_id JOIN library_members lm ON lm.library_id=w.library_id WHERE j.id=? AND lm.user_id=? AND lm.role IN ('owner','editor')`, id, userID).Scan(&allowed); err != nil {
		return 0, fmt.Errorf("authorize alignment cancellation: %w", err)
	}
	return allowed, nil
}

func (m *Manager) claim(ctx context.Context) (Job, bool, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return Job{}, false, err
	}
	defer tx.Rollback()
	job, err := m.scanJob(tx.QueryRowContext(ctx, `SELECT id,COALESCE(alignment_id,''),epub_media_id,audio_media_id,state,attempts,worker_version,model,COALESCE(artifact_id,''),error_summary,created_at,started_at,finished_at FROM alignment_jobs WHERE state='pending' AND cancel_requested=0 ORDER BY created_at LIMIT 1`))
	if errors.Is(err, sql.ErrNoRows) {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := tx.ExecContext(ctx, `UPDATE alignment_jobs SET state='processing',attempts=attempts+1,started_at=?,error_summary='' WHERE id=? AND state='pending'`, now, job.ID)
	if err != nil {
		return Job{}, false, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return Job{}, false, nil
	}
	if err := tx.Commit(); err != nil {
		return Job{}, false, err
	}
	job.State = "processing"
	job.Attempts++
	return job, true, nil
}
func (m *Manager) run(parent context.Context, job Job) {
	ctx, cancel := context.WithTimeout(parent, m.options.Timeout)
	m.mu.Lock()
	m.cancel[job.ID] = cancel
	m.mu.Unlock()
	defer func() { cancel(); m.mu.Lock(); delete(m.cancel, job.ID); m.mu.Unlock() }()
	artifactPath, artifactID, err := m.execute(ctx, job)
	summary := workerFailureSummary(err)
	if err == nil {
		err = m.publish(ctx, job, artifactPath, artifactID)
		summary = "artifact validation failed"
	}
	if err != nil {
		if parent.Err() != nil {
			return
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			summary = "canceled"
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			summary = "worker timeout"
		}
		_, _ = m.db.Exec(`UPDATE alignment_jobs SET state='failed',error_summary=?,finished_at=? WHERE id=?`, summary, time.Now().UTC().Format(time.RFC3339Nano), job.ID)
	}
}

func workerFailureSummary(err error) string {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == 78 {
		return "GPU acceleration unavailable; check the NVIDIA driver and Docker GPU access"
	}
	return "worker execution failed"
}
func (m *Manager) execute(ctx context.Context, job Job) (string, string, error) {
	dir := filepath.Join(m.options.ArtifactRoot, job.ID)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", "", err
	}
	input, err := m.input(ctx, job)
	if err != nil {
		return "", "", err
	}
	inputPath, outputPath := filepath.Join(dir, "input.json"), filepath.Join(dir, "alignment.json")
	data, _ := json.MarshalIndent(input, "", "  ")
	if err := os.WriteFile(inputPath, append(data, '\n'), 0o600); err != nil {
		return "", "", err
	}
	args := append(append([]string{}, m.options.Command[1:]...), "--job-input", inputPath, "--output", outputPath)
	command := exec.CommandContext(ctx, m.options.Command[0], args...)
	command.Env = append(
		os.Environ(),
		"HF_HOME="+m.options.ModelRoot,
		"TORCH_HOME="+filepath.Join(m.options.ModelRoot, "torch"),
		"NLTK_DATA="+filepath.Join(m.options.ModelRoot, "nltk"),
		"MPLCONFIGDIR="+filepath.Join(m.options.ArtifactRoot, "matplotlib"),
		"HF_HUB_OFFLINE=1",
		"TRANSFORMERS_OFFLINE=1",
	)
	logFile, err := os.OpenFile(filepath.Join(dir, "worker.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", "", err
	}
	defer logFile.Close()
	bounded := &limitWriter{writer: logFile, remaining: 1 << 20}
	command.Stdout = bounded
	command.Stderr = bounded
	if err := command.Run(); err != nil {
		return "", "", fmt.Errorf("worker failed: %w", err)
	}
	bytes, err := readArtifact(outputPath)
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256(bytes)
	return outputPath, hex.EncodeToString(sum[:]), nil
}

type limitWriter struct {
	writer    io.Writer
	remaining int
}

func (w *limitWriter) Write(p []byte) (int, error) {
	original := len(p)
	if len(p) > w.remaining {
		p = p[:w.remaining]
	}
	w.remaining -= len(p)
	if len(p) > 0 {
		if _, err := w.writer.Write(p); err != nil {
			return 0, err
		}
	}
	return original, nil
}

func (m *Manager) input(ctx context.Context, job Job) (workerInput, error) {
	var eh, ah string
	if err := m.db.QueryRowContext(ctx, `SELECT e.sha256,a.sha256 FROM media e,media a WHERE e.id=? AND a.id=?`, job.EPUBMediaID, job.AudioMediaID).Scan(&eh, &ah); err != nil {
		return workerInput{}, err
	}
	epub, err := m.media.OpenMedia(ctx, job.EPUBMediaID, true)
	if err != nil {
		return workerInput{}, ErrInvalid
	}
	defer epub.Close()
	audio, err := m.media.OpenMedia(ctx, job.AudioMediaID, true)
	if err != nil {
		return workerInput{}, ErrInvalid
	}
	defer audio.Close()
	ep, ap := epub.Name(), audio.Name()
	book, err := position.ImportEPUB(ep)
	if err != nil {
		return workerInput{}, err
	}
	documentID, err := position.KOReaderPartialMD5(epub)
	if err != nil {
		return workerInput{}, fmt.Errorf("identify KOReader EPUB: %w", err)
	}
	duration, err := m.options.AudioDuration(ctx, ap)
	if err != nil {
		return workerInput{}, fmt.Errorf("read audio duration: %w", err)
	}
	if duration <= 0 {
		return workerInput{}, errors.New("invalid audio duration")
	}
	input := workerInput{
		Version:            ContractVersion,
		EPUBPath:           ep,
		AudioPath:          ap,
		EPUBSHA256:         eh,
		AudioSHA256:        ah,
		AudioResource:      filepath.Base(ap),
		AudioDuration:      duration,
		Model:              m.options.Model,
		KOReaderDocumentID: documentID,
	}
	for i, p := range book.Paragraphs {
		input.Segments = append(input.Segments, inputSegment{
			ID:              fmt.Sprintf("s%06d", i+1),
			Ordinal:         i,
			Text:            p.Text,
			Href:            p.Href,
			DOMPath:         p.DOMPath,
			KOReaderLocator: position.MarshalKOReaderParagraph(p),
		})
	}
	if len(input.Segments) == 0 {
		return workerInput{}, ErrInvalid
	}
	return input, nil
}

func readArtifact(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxArtifactBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxArtifactBytes {
		return nil, errors.New("alignment artifact is too large")
	}
	return data, nil
}

func audioDuration(ctx context.Context, path string) (int64, error) {
	output, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path).Output()
	if err != nil {
		return 0, err
	}
	var seconds float64
	if _, err := fmt.Sscan(strings.TrimSpace(string(output)), &seconds); err != nil || seconds <= 0 {
		return 0, errors.New("invalid ffprobe duration")
	}
	return int64(seconds * 1000), nil
}

func (m *Manager) publish(ctx context.Context, job Job, path, artifactID string) error {
	data, err := readArtifact(path)
	if err != nil {
		return err
	}
	var artifact Artifact
	if err := json.Unmarshal(data, &artifact); err != nil {
		return fmt.Errorf("invalid artifact JSON: %w", err)
	}
	input, err := m.input(ctx, job)
	if err != nil {
		return err
	}
	if err := validate(artifact, input, m.options.WorkerVersion); err != nil {
		return err
	}
	// Publish every segment and retire the previous alignment in one transaction.
	// Readers must never observe a partially written alignment.
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	alignmentID := job.ID
	if _, err := tx.ExecContext(ctx, `INSERT INTO alignments(id,epub_media_id,audio_media_id,revision,state,created_at) VALUES(?,?,?,1,'processing',?)`, alignmentID, job.EPUBMediaID, job.AudioMediaID, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return err
	}
	for _, segment := range artifact.Segments {
		locator := segment.EPUB.Locator
		confidence := segment.Confidence
		if len(confidence) == 0 {
			confidence = []byte(`{}`)
		}
		word := segment.WordTimings
		if len(word) == 0 {
			word = nil
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO alignment_segments(alignment_id,id,ordinal,text,epub_href,epub_locator,koreader_locator,audio_resource,audio_start_ms,audio_end_ms,word_timings,highlightable,alignment_status,confidence_signals) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, alignmentID, segment.ID, segment.Ordinal, segment.Text, segment.EPUB.Href, string(locator), input.Segments[segment.Ordinal].KOReaderLocator, segment.Audio.Resource, segment.Audio.StartMS, segment.Audio.EndMS, string(word), segment.Highlightable, segment.Status, string(confidence))
		if err != nil {
			return fmt.Errorf("insert alignment segment: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO alignment_inputs(alignment_id,media_id,role) VALUES(?,?,'epub'),(?,?,'audio')`, alignmentID, job.EPUBMediaID, alignmentID, job.AudioMediaID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO koreader_aliases(document_id,media_id) VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET media_id=excluded.media_id WHERE (SELECT representation_id FROM media WHERE id=koreader_aliases.media_id)=(SELECT representation_id FROM media WHERE id=excluded.media_id)`, input.KOReaderDocumentID, job.EPUBMediaID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alignments SET state='stale' WHERE id!=? AND state='ready' AND EXISTS(SELECT 1 FROM alignment_inputs ai WHERE ai.alignment_id=alignments.id AND ai.media_id IN (?,?))`, alignmentID, job.EPUBMediaID, job.AudioMediaID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alignment_jobs SET state='stale',finished_at=? WHERE id!=? AND state='ready' AND alignment_id IN (SELECT id FROM alignments WHERE state='stale')`, time.Now().UTC().Format(time.RFC3339Nano), job.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE alignments SET state='ready' WHERE id=?`, alignmentID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE alignment_jobs SET state='ready',alignment_id=?,artifact_id=?,finished_at=?,error_summary='' WHERE id=? AND state='processing' AND cancel_requested=0`, alignmentID, artifactID, time.Now().UTC().Format(time.RFC3339Nano), job.ID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return errors.New("alignment job is no longer publishable")
	}
	return tx.Commit()
}

func validate(a Artifact, input workerInput, tool string) error {
	if a.Version != ContractVersion || a.Tool != tool || a.Model != input.Model || a.EPUBSHA256 != input.EPUBSHA256 || a.AudioSHA256 != input.AudioSHA256 || len(a.Segments) != len(input.Segments) {
		return errors.New("artifact contract or input mismatch")
	}
	lastEnd := int64(-1)
	ids := map[string]bool{}
	for i, s := range a.Segments {
		expected := input.Segments[i]
		if s.ID != expected.ID || ids[s.ID] || s.Ordinal != expected.Ordinal || s.Text != expected.Text || strings.Join(strings.Fields(s.NormalizedText), " ") != strings.Join(strings.Fields(expected.Text), " ") || s.EPUB.Href != expected.Href || s.EPUB.DOMPath != expected.DOMPath || !validLocator(s.EPUB.Locator, expected.DOMPath) || s.Audio.Resource != input.AudioResource || s.Audio.StartMS < 0 || s.Audio.EndMS <= s.Audio.StartMS || s.Audio.EndMS > input.AudioDuration || s.Audio.StartMS < lastEnd {
			return fmt.Errorf("invalid segment %d", i)
		}
		if s.Status != "aligned" && s.Status != "unresolved" && s.Status != "edge_clipped" && s.Status != "text_mismatch" {
			return fmt.Errorf("invalid segment status %d", i)
		}
		if s.Status != "aligned" && s.Highlightable {
			return fmt.Errorf("unsafe highlightable segment %d", i)
		}
		if len(s.Confidence) > 0 && !json.Valid(s.Confidence) {
			return fmt.Errorf("invalid confidence %d", i)
		}
		if len(s.WordTimings) > 0 && !json.Valid(s.WordTimings) {
			return fmt.Errorf("invalid words %d", i)
		}
		if err := validateWords(s.WordTimings, s.Audio.StartMS, s.Audio.EndMS); err != nil {
			return fmt.Errorf("invalid words %d", i)
		}
		ids[s.ID] = true
		lastEnd = s.Audio.EndMS
	}
	return nil
}

func validLocator(raw json.RawMessage, expectedPath string) bool {
	var locator struct {
		Type    string `json:"type"`
		DOMPath string `json:"dom_path"`
	}
	return json.Unmarshal(raw, &locator) == nil && locator.Type == "dom-element" && locator.DOMPath == expectedPath
}

func validateWords(raw json.RawMessage, segmentStart, segmentEnd int64) error {
	if len(raw) == 0 {
		return nil
	}
	var words []struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
	}
	if err := json.Unmarshal(raw, &words); err != nil {
		return err
	}
	last := float64(segmentStart)/1000 - .002
	for _, word := range words {
		if math.IsNaN(word.Start) || math.IsInf(word.Start, 0) || math.IsNaN(word.End) || math.IsInf(word.End, 0) || word.Start < last || word.End <= word.Start || word.End > float64(segmentEnd)/1000+.002 {
			return ErrInvalid
		}
		last = word.End
	}
	return nil
}

type scanner interface{ Scan(...any) error }

func (m *Manager) scanJob(row scanner) (Job, error) {
	var j Job
	var created string
	var started, finished sql.NullString
	err := row.Scan(&j.ID, &j.AlignmentID, &j.EPUBMediaID, &j.AudioMediaID, &j.State, &j.Attempts, &j.WorkerVersion, &j.Model, &j.ArtifactID, &j.Error, &created, &started, &finished)
	if err != nil {
		return Job{}, err
	}
	j.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	if started.Valid {
		v, _ := time.Parse(time.RFC3339Nano, started.String)
		j.StartedAt = &v
	}
	if finished.Valid {
		v, _ := time.Parse(time.RFC3339Nano, finished.String)
		j.FinishedAt = &v
	}
	return j, nil
}
func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
