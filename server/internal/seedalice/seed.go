package seedalice

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	WorkID       = "alice-gutenberg-11-work"
	EPUBRepID    = "alice-gutenberg-11-epub"
	AudioRepID   = "alice-librivox-chapter-01"
	EPUBMediaID  = "alice-gutenberg-11-epub-media"
	AudioMediaID = "alice-librivox-chapter-01-media"
	AlignmentID  = "alice-hybrid-whisperx-alignment"
	JobID        = "alice-hybrid-whisperx-job"
	epubHash     = "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c"
	audioHash    = "6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a"
)

type artifact struct {
	Version     int    `json:"version"`
	Tool        string `json:"tool"`
	Model       string `json:"model"`
	EPUBSHA256  string `json:"epub_sha256"`
	AudioSHA256 string `json:"audio_sha256"`
	Segments    []struct {
		ID       string `json:"id"`
		Sequence int    `json:"sequence"`
		Text     string `json:"text"`
		EPUB     struct {
			Href  string `json:"href"`
			Start struct {
				DOMPath    string `json:"dom_path"`
				NodeOffset int    `json:"node_offset"`
			} `json:"start"`
			End struct {
				DOMPath    string `json:"dom_path"`
				NodeOffset int    `json:"node_offset"`
			} `json:"end"`
		} `json:"epub"`
		Audio struct {
			Resource string `json:"resource"`
			StartMS  int64  `json:"start_ms"`
			EndMS    int64  `json:"end_ms"`
		} `json:"audio"`
		Confidence  json.RawMessage `json:"confidence"`
		WordTimings json.RawMessage `json:"word_timings"`
		Quality     struct {
			TextMatch float64 `json:"text_match"`
			Status    string  `json:"status"`
		} `json:"alignment_quality"`
	} `json:"segments"`
}

func Seed(ctx context.Context, db *sql.DB, dataDir, fixtureDir, artifactPath string) error {
	if os.Getenv("ALDUS_ENV") != "development" && os.Getenv("ALDUS_ENV") != "test" {
		return errors.New("Alice seed requires ALDUS_ENV=development or test")
	}
	data, err := os.ReadFile(artifactPath)
	if err != nil {
		return fmt.Errorf("read Alice alignment: %w", err)
	}
	var a artifact
	if err := json.Unmarshal(data, &a); err != nil {
		return fmt.Errorf("decode Alice alignment: %w", err)
	}
	if a.Version != 1 || a.EPUBSHA256 != epubHash || a.AudioSHA256 != audioHash || len(a.Segments) != 87 {
		return errors.New("Alice alignment does not match the frozen fixture")
	}
	epubRel, epubSize, err := install(filepath.Join(fixtureDir, "alice.epub"), filepath.Join(dataDir, "media"), epubHash, ".epub")
	if err != nil {
		return err
	}
	audioRel, audioSize, err := install(filepath.Join(fixtureDir, "alice-chapter-01.mp3"), filepath.Join(dataDir, "media"), audioHash, ".audio")
	if err != nil {
		return err
	}
	now := time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var libraryID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM libraries WHERE name='Public' ORDER BY created_at LIMIT 1`).Scan(&libraryID)
	if errors.Is(err, sql.ErrNoRows) {
		libraryID = "alice-public-library"
		_, err = tx.ExecContext(ctx, `INSERT INTO libraries(id,name,created_at,updated_at) VALUES(?,'Public',?,?)`, libraryID, now, now)
	}
	if err != nil {
		return err
	}
	workID, epubRepID, audioRepID := WorkID, EPUBRepID, AudioRepID
	epubMediaID, audioMediaID := EPUBMediaID, AudioMediaID
	err = tx.QueryRowContext(ctx, `
		SELECT w.id,er.id,em.id,ar.id,am.id
		FROM works w
		JOIN representations er ON er.work_id=w.id AND er.kind='epub'
		JOIN media em ON em.representation_id=er.id AND em.sha256=?
		JOIN representations ar ON ar.work_id=w.id AND ar.kind IN ('audio','audiobook')
		JOIN media am ON am.representation_id=ar.id AND am.sha256=?
		WHERE w.library_id=?
		ORDER BY w.created_at
		LIMIT 1`, epubHash, audioHash, libraryID).Scan(
		&workID, &epubRepID, &epubMediaID, &audioRepID, &audioMediaID,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("find existing Alice media: %w", err)
	}
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT OR IGNORE INTO library_members(library_id,user_id,role,created_at) SELECT ?,id,'reader',? FROM users`, []any{libraryID, now}},
		{`INSERT OR IGNORE INTO works(id,library_id,title,author,created_at,updated_at) VALUES(?,?,'Alice''s Adventures in Wonderland','Lewis Carroll',?,?)`, []any{workID, libraryID, now, now}},
		{`INSERT OR IGNORE INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES(?,?,'epub','Standard edition',?,?)`, []any{epubRepID, workID, now, now}},
		{`INSERT OR IGNORE INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES(?,?,'audiobook','Chapter One narration',?,?)`, []any{audioRepID, workID, now, now}},
		{`INSERT OR IGNORE INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes) VALUES(?,?,'epub',?,?,?,'alice.epub',?)`, []any{epubMediaID, epubRepID, epubRel, epubHash, now, epubSize}},
		{`INSERT OR IGNORE INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes) VALUES(?,?,'audiobook',?,?,?,'alice-chapter-01.mp3',?)`, []any{audioMediaID, audioRepID, audioRel, audioHash, now, audioSize}},
		{`INSERT OR IGNORE INTO alignments(id,epub_media_id,audio_media_id,revision,state,created_at) VALUES(?,?,?,1,'ready',?)`, []any{AlignmentID, epubMediaID, audioMediaID, now}},
		{`INSERT OR IGNORE INTO alignment_inputs(alignment_id,media_id,role) VALUES(?,?,'epub'),(?,?,'audio')`, []any{AlignmentID, epubMediaID, AlignmentID, audioMediaID}},
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return fmt.Errorf("seed Alice: %w", err)
		}
	}
	for _, segment := range a.Segments {
		locator, _ := json.Marshal(map[string]any{"type": "dom-element", "dom_path": paragraphPath(segment.EPUB.Start.DOMPath), "segment_id": segment.ID, "start": segment.EPUB.Start, "end": segment.EPUB.End})
		confidence, _ := json.Marshal(map[string]any{"confidence": json.RawMessage(segment.Confidence), "alignment_quality": segment.Quality})
		highlightable := segment.Quality.Status == "aligned"
		_, err := tx.ExecContext(ctx, `INSERT INTO alignment_segments(alignment_id,id,ordinal,text,epub_href,epub_locator,koreader_locator,audio_resource,audio_start_ms,audio_end_ms,word_timings,highlightable,alignment_status,confidence_signals) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(alignment_id,id) DO UPDATE SET epub_locator=excluded.epub_locator`, AlignmentID, segment.ID, segment.Sequence, segment.Text, segment.EPUB.Href, string(locator), "unavailable:"+segment.ID, segment.Audio.Resource, segment.Audio.StartMS, segment.Audio.EndMS, string(segment.WordTimings), highlightable, segment.Quality.Status, string(confidence))
		if err != nil {
			return fmt.Errorf("seed Alice segment %s: %w", segment.ID, err)
		}
	}
	artifactHash := sha256.Sum256(data)
	_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO alignment_jobs(id,alignment_id,epub_media_id,audio_media_id,state,attempts,worker_version,model,artifact_id,error_summary,created_at,started_at,finished_at) VALUES(?,?,?,?,'ready',1,?,?,?,'',?,?,?)`, JobID, AlignmentID, epubMediaID, audioMediaID, a.Tool, a.Model, hex.EncodeToString(artifactHash[:]), now, now, now)
	if err != nil {
		return fmt.Errorf("seed Alice job: %w", err)
	}
	var segments, unresolved int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),SUM(CASE WHEN highlightable=0 AND alignment_status='unresolved' THEN 1 ELSE 0 END) FROM alignment_segments WHERE alignment_id=?`, AlignmentID).Scan(&segments, &unresolved); err != nil {
		return err
	}
	if segments != len(a.Segments) || unresolved != 2 {
		return fmt.Errorf("seeded Alice alignment failed integrity check: segments=%d unresolved=%d", segments, unresolved)
	}
	return tx.Commit()
}

func paragraphPath(path string) string {
	for _, tag := range []string{"/p[", "/h1[", "/h2[", "/h3[", "/h4["} {
		if index := strings.LastIndex(path, tag); index >= 0 {
			end := index + len(tag)
			for end < len(path) && path[end] >= '0' && path[end] <= '9' {
				end++
			}
			if end < len(path) && path[end] == ']' {
				return path[:end+1]
			}
		}
	}
	return path
}

func install(source, mediaRoot, wantHash, extension string) (string, int64, error) {
	file, err := os.Open(source)
	if err != nil {
		return "", 0, fmt.Errorf("open frozen media: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	if hex.EncodeToString(hash.Sum(nil)) != wantHash {
		return "", 0, errors.New("frozen media hash mismatch")
	}
	relative := filepath.Join(wantHash[:2], wantHash+extension)
	target := filepath.Join(mediaRoot, "media", relative)
	if _, err := os.Stat(target); err == nil {
		return relative, size, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", 0, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return "", 0, err
	}
	input, err := os.Open(source)
	if err != nil {
		return "", 0, err
	}
	defer input.Close()
	temp, err := os.CreateTemp(filepath.Dir(target), ".alice-*")
	if err != nil {
		return "", 0, err
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err := io.Copy(temp, input); err != nil {
		temp.Close()
		return "", 0, err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return "", 0, err
	}
	if err := temp.Close(); err != nil {
		return "", 0, err
	}
	if err := os.Rename(name, target); err != nil {
		return "", 0, err
	}
	return relative, size, nil
}
