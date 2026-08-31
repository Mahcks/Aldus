package source

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/position"
)

var ErrConflict = errors.New("proposal changed")

type AcceptRequest struct {
	ExpectedRevision int
	WorkID           string
	Title            string
	Author           string
	Items            []AcceptItem
}

type AcceptItem struct {
	SourceEntryID    string
	RepresentationID string
	Kind             string
	Label            string
}

func (s *Store) AcceptProposal(ctx context.Context, actor auth.User, libraryID, proposalID string, request AcceptRequest) (string, error) {
	if request.ExpectedRevision <= 0 || len(request.Items) == 0 {
		return "", ErrInvalid
	}
	if ok, err := canReview(ctx, s.db, actor, libraryID); err != nil || !ok {
		if err != nil {
			return "", err
		}
		return "", ErrNotFound
	}
	var currentRevision int
	var currentState, currentDecision string
	err := s.db.QueryRowContext(ctx, `SELECT revision,state,decision FROM import_groups WHERE id=? AND library_id=?`, proposalID, libraryID).Scan(&currentRevision, &currentState, &currentDecision)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if currentRevision != request.ExpectedRevision || currentDecision != "" || currentState == "obsolete" {
		return "", ErrConflict
	}
	verified := make(map[string]bool, len(request.Items))
	koReaderDocuments := make(map[string]string, len(request.Items))
	for _, item := range request.Items {
		kind := item.Kind
		if kind == "audiobook" {
			kind = "audio"
		}
		if kind != "epub" && kind != "audio" {
			return "", ErrInvalid
		}
		var entryID, hash, entryKind, state string
		err := s.db.QueryRowContext(ctx, `SELECT e.id,COALESCE(e.sha256,''),e.detected_kind,e.state FROM import_items i JOIN import_groups g ON g.id=i.group_id JOIN source_entries e ON e.id=i.source_entry_id WHERE g.id=? AND g.library_id=? AND e.id=?`, proposalID, libraryID, item.SourceEntryID).Scan(&entryID, &hash, &entryKind, &state)
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrInvalid
		}
		if err != nil {
			return "", err
		}
		if state != "registered" || len(hash) != 64 || (entryKind == "epub") != (kind == "epub") {
			return "", ErrConflict
		}
		if verified[entryID] {
			continue
		}
		file, err := openEntry(ctx, s.db, entryID)
		if err != nil {
			return "", ErrConflict
		}
		if kind == "epub" {
			koReaderDocuments[entryID], err = position.KOReaderPartialMD5(file)
			if err != nil {
				file.Close()
				return "", ErrConflict
			}
		}
		if err := file.Close(); err != nil {
			return "", ErrConflict
		}
		verified[entryID] = true
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if ok, err := canReview(ctx, tx, actor, libraryID); err != nil || !ok {
		if err != nil {
			return "", err
		}
		return "", ErrNotFound
	}
	var revision int
	var state, decision string
	err = tx.QueryRowContext(ctx, `SELECT revision,state,decision FROM import_groups WHERE id=? AND library_id=?`, proposalID, libraryID).Scan(&revision, &state, &decision)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if revision != request.ExpectedRevision || decision != "" || state == "obsolete" {
		return "", ErrConflict
	}
	workID := request.WorkID
	if workID != "" {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM works WHERE id=? AND library_id=?`, workID, libraryID).Scan(&n); err != nil || n != 1 {
			if err != nil {
				return "", err
			}
			return "", ErrInvalid
		}
	} else {
		title := strings.TrimSpace(request.Title)
		author := strings.TrimSpace(request.Author)
		if title == "" || len(title) > 500 || len(author) > 500 {
			return "", ErrInvalid
		}
		workID, err = randomID()
		if err != nil {
			return "", err
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, `INSERT INTO works(id,library_id,title,author,created_at,updated_at) VALUES(?,?,?,?,?,?)`, workID, libraryID, title, nullValue(author), now, now); err != nil {
			return "", err
		}
	}
	seen := map[string]string{}
	coverMediaID := ""
	for _, item := range request.Items {
		kind := item.Kind
		if kind == "audiobook" {
			kind = "audio"
		}
		if kind != "epub" && kind != "audio" {
			return "", ErrInvalid
		}
		var entryID, path, hash, entryKind, state, metadataJSON string
		var size int64
		err := tx.QueryRowContext(ctx, `SELECT e.id,e.relative_path,COALESCE(e.sha256,''),e.detected_kind,e.state,e.size_bytes,e.metadata_json FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE i.group_id=? AND e.id=?`, proposalID, item.SourceEntryID).Scan(&entryID, &path, &hash, &entryKind, &state, &size, &metadataJSON)
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrInvalid
		}
		if err != nil {
			return "", err
		}
		if state != "registered" || len(hash) != 64 || (entryKind == "epub") != (kind == "epub") {
			return "", ErrConflict
		}
		representationID := item.RepresentationID
		if duplicate := seen[kind+"\x00"+hash]; duplicate != "" {
			representationID = duplicate
		}
		if representationID != "" {
			var existingKind string
			err := tx.QueryRowContext(ctx, `SELECT r.kind FROM representations r JOIN works w ON w.id=r.work_id WHERE r.id=? AND w.id=?`, representationID, workID).Scan(&existingKind)
			if err != nil || existingKind != kind {
				return "", ErrInvalid
			}
		} else {
			representationID, err = randomID()
			if err != nil {
				return "", err
			}
			label := strings.TrimSpace(item.Label)
			if label == "" {
				if kind == "epub" {
					label = "EPUB edition"
				} else {
					label = "Audiobook"
				}
			}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			if _, err := tx.ExecContext(ctx, `INSERT INTO representations(id,work_id,kind,label,created_at,updated_at) VALUES(?,?,?,?,?,?)`, representationID, workID, kind, label, now, now); err != nil {
				return "", err
			}
		}
		seen[kind+"\x00"+hash] = representationID
		var mediaID string
		err = tx.QueryRowContext(ctx, `SELECT id FROM media WHERE representation_id=? AND sha256=?`, representationID, hash).Scan(&mediaID)
		if errors.Is(err, sql.ErrNoRows) {
			mediaID, err = randomID()
			if err != nil {
				return "", err
			}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			if _, err := tx.ExecContext(ctx, `INSERT INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes,storage_kind,source_entry_id) VALUES(?,?,?,?,?,?,?,?, 'referenced',?)`, mediaID, representationID, kind, "", hash, now, filepathBase(path), size, entryID); err != nil {
				return "", err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE alignments SET state='stale' WHERE state!='stale' AND EXISTS(SELECT 1 FROM alignment_inputs ai JOIN media old ON old.id=ai.media_id WHERE ai.alignment_id=alignments.id AND old.representation_id=? AND old.id!=?)`, representationID, mediaID); err != nil {
				return "", err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE alignment_jobs SET state='stale',finished_at=? WHERE state='ready' AND alignment_id IN (SELECT id FROM alignments WHERE state='stale')`, now); err != nil {
				return "", err
			}
		} else if err != nil {
			return "", err
		}
		if documentID := koReaderDocuments[entryID]; documentID != "" {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO koreader_aliases(document_id,media_id) VALUES(?,?)`, documentID, mediaID); err != nil {
				return "", err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO media_locations(media_id,source_entry_id,created_at) VALUES(?,?,?)`, mediaID, entryID, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return "", err
		}
		var metadata map[string]any
		_ = json.Unmarshal([]byte(metadataJSON), &metadata)
		if coverMediaID == "" && metadata["has_cover"] == true {
			coverMediaID = mediaID
		}
	}
	if coverMediaID != "" {
		coverID, err := randomID()
		if err != nil {
			return "", err
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, `INSERT INTO work_covers(id,work_id,source,source_id,image_url,created_at) VALUES(?,?,'embedded',?,?,?) ON CONFLICT(work_id,source,source_id) DO NOTHING`, coverID, workID, coverMediaID, "/api/media/"+coverMediaID+"/cover", now); err != nil {
			return "", err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE works SET selected_cover_id=(SELECT id FROM work_covers WHERE work_id=? AND source='embedded' AND source_id=?),updated_at=? WHERE id=? AND selected_cover_id IS NULL`, workID, coverMediaID, now, workID); err != nil {
			return "", err
		}
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := tx.ExecContext(ctx, `UPDATE import_groups SET decision='accepted',accepted_work_id=?,state='obsolete',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND decision=''`, workID, stamp, proposalID, request.ExpectedRevision)
	if err != nil {
		return "", err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return "", ErrConflict
	}
	if err := updateAcceptedOutcome(ctx, tx, proposalID, workID, stamp); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return workID, nil
}

func (s *Store) IgnoreProposal(ctx context.Context, actor auth.User, libraryID, id string, revision int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if ok, err := canReview(ctx, tx, actor, libraryID); err != nil || !ok {
		if err != nil {
			return err
		}
		return ErrNotFound
	}
	result, err := tx.ExecContext(ctx, `UPDATE import_groups SET decision='ignored',state='obsolete',revision=revision+1,updated_at=? WHERE id=? AND library_id=? AND revision=? AND decision=''`, time.Now().UTC().Format(time.RFC3339Nano), id, libraryID, revision)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE acquisition_import_outcomes SET state='failed',reason='The import proposal was dismissed during review.',updated_at=? WHERE proposal_id=?`, time.Now().UTC().Format(time.RFC3339Nano), id); err != nil {
		return err
	}
	return tx.Commit()
}

type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func canReview(ctx context.Context, db rowQuerier, actor auth.User, libraryID string) (bool, error) {
	var n int
	args := append([]any{actor.ID, libraryID}, auth.LibraryEditArgs(actor)...)
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries l LEFT JOIN library_members lm ON lm.library_id=l.id AND lm.user_id=? WHERE l.id=? AND `+auth.EffectiveLibraryEditSQL("l.id", "lm"), args...).Scan(&n)
	return n == 1, err
}

func openEntry(ctx context.Context, db rowQuerier, entryID string) (*os.File, error) {
	var root, path, hash string
	var size int64
	var modified string
	var enabled int
	err := db.QueryRowContext(ctx, `SELECT ls.root_path,e.relative_path,e.sha256,e.size_bytes,e.modified_at,ls.enabled FROM source_entries e JOIN library_sources ls ON ls.id=e.source_id AND ls.deleted_at IS NULL WHERE e.id=? AND e.state='registered'`, entryID).Scan(&root, &path, &hash, &size, &modified, &enabled)
	if err != nil || enabled == 0 {
		return nil, ErrUnavailable
	}
	file, err := openRegular(root, path)
	if err != nil {
		return nil, err
	}
	info, _ := file.Stat()
	if info == nil || info.Size() != size || info.ModTime().UTC().Format(time.RFC3339Nano) != modified {
		file.Close()
		return nil, ErrUnavailable
	}
	got, err := hashOpen(ctx, file)
	if err != nil || got != hash {
		file.Close()
		return nil, ErrUnavailable
	}
	return file, nil
}
func hashOpen(ctx context.Context, file *os.File) (string, error) {
	h := sha256.New()
	buffer := make([]byte, 128<<10)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, err := file.Read(buffer)
		if n > 0 {
			h.Write(buffer[:n])
		}
		if err == io.EOF {
			return fmt.Sprintf("%x", h.Sum(nil)), nil
		}
		if err != nil {
			return "", err
		}
	}
}
func filepathBase(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	parts := strings.Split(path, "/")
	return parts[len(parts)-1]
}
