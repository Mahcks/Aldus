package source

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/mahcks/aldus/server/internal/auth"
	"golang.org/x/text/unicode/norm"
)

type Proposal struct {
	ID               string
	LibraryID        string
	State            string
	Confidence       string
	Title            string
	Author           string
	NormalizedTitle  string
	NormalizedAuthor string
	ExistingWorkID   string
	Reasons          []string
	Revision         int
	Items            []ProposalItem
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type ProposalItem struct {
	EntryID      string
	RelativePath string
	Kind         string
	Label        string
	SHA256       string
	DuplicateOf  string
	Evidence     map[string]any
}

type proposalEntry struct {
	ID             string
	Path           string
	Kind           string
	Hash           string
	Title          string
	Author         string
	Metadata       map[string]any
	AdvisoryTitle  string
	AdvisoryAuthor string
	AdvisoryISBN   string
	AdvisoryCover  string
	AdvisoryYear   int
}

func (s *Store) GenerateProposals(ctx context.Context, libraryID string) error {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id,e.relative_path,e.detected_kind,e.sha256,e.metadata_json,COALESCE(ar.advisory_title,''),COALESCE(ar.advisory_author,''),COALESCE(ar.advisory_isbn,''),COALESCE(ar.advisory_year,0),COALESCE(ar.advisory_cover_url,'') FROM source_entries e JOIN library_sources ls ON ls.id=e.source_id LEFT JOIN source_scans sc ON sc.id=e.last_seen_scan_id LEFT JOIN acquisition_requests ar ON ar.id=sc.acquisition_request_id WHERE ls.library_id=? AND ls.deleted_at IS NULL AND e.state='registered' ORDER BY e.id`, libraryID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var entries []proposalEntry
	for rows.Next() {
		var e proposalEntry
		var raw string
		if err := rows.Scan(&e.ID, &e.Path, &e.Kind, &e.Hash, &raw, &e.AdvisoryTitle, &e.AdvisoryAuthor, &e.AdvisoryISBN, &e.AdvisoryYear, &e.AdvisoryCover); err != nil {
			return err
		}
		_ = json.Unmarshal([]byte(raw), &e.Metadata)
		e.Title, e.Author = identityMetadata(e)
		if e.Title == "" {
			e.Title = e.AdvisoryTitle
		}
		if e.Author == "" {
			e.Author = e.AdvisoryAuthor
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	groups := map[string][]proposalEntry{}
	titleAuthors := map[string]map[string]bool{}
	for _, e := range entries {
		title, author := normalize(e.Title), normalize(e.Author)
		if title != "" && author != "" {
			if titleAuthors[title] == nil {
				titleAuthors[title] = map[string]bool{}
			}
			titleAuthors[title][author] = true
		}
		key := "entry:" + e.ID
		if title != "" && author != "" {
			key = "identity:" + title + "\x00" + author
		}
		groups[key] = append(groups[key], e)
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	seen := map[string]bool{}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err = tx.ExecContext(ctx, `UPDATE import_groups SET state='obsolete',updated_at=? WHERE library_id=? AND state!='obsolete'`, now, libraryID); err != nil {
		return err
	}
	for _, key := range keys {
		items := groups[key]
		contentHash := sha256.New()
		for _, item := range items {
			contentHash.Write([]byte(item.ID + "\x00" + item.Hash + "\x00" + string(mustJSON(item.Metadata))))
		}
		contentKey := fmt.Sprintf("%x", contentHash.Sum(nil))
		first := items[0]
		nt, na := normalize(first.Title), normalize(first.Author)
		confidence, state := "high", "proposed"
		reasons := []string{"Embedded title and primary author agree exactly after Unicode, case, punctuation, and whitespace normalization."}
		if nt == "" || na == "" {
			confidence, state = "low", "review_required"
			reasons = []string{"Core embedded title or primary author is missing; no automatic grouping was performed."}
		} else if len(titleAuthors[nt]) > 1 {
			confidence, state = "medium", "review_required"
			reasons = []string{"The normalized title matches other entries with a different primary author."}
		} else if sameKindVariants(items) {
			confidence, state = "medium", "review_required"
			reasons = []string{"Multiple distinct files of the same Representation kind require edition or narration review."}
		}
		metadata := make([]map[string]any, 0, len(items))
		for _, item := range items {
			metadata = append(metadata, item.Metadata)
		}
		if _, _, agrees := agreedSeries(metadata); !agrees {
			confidence, state = "medium", "review_required"
			reasons = append(reasons, "Series tags conflict or contain an invalid position. Review the series fields; no series will be inferred.")
		}
		sum := sha256.Sum256([]byte(key))
		logical := fmt.Sprintf("%x", sum)
		var id string
		var oldRevision int
		var oldContent, decision string
		err := tx.QueryRowContext(ctx, `SELECT id,revision,content_key,decision FROM import_groups WHERE library_id=? AND logical_key=?`, libraryID, logical).Scan(&id, &oldRevision, &oldContent, &decision)
		if errors.Is(err, sql.ErrNoRows) {
			id, err = randomID()
			if err != nil {
				return err
			}
			oldRevision = 0
		} else if err != nil {
			return err
		}
		revision := oldRevision
		if revision == 0 || oldContent != contentKey {
			revision++
		}
		if oldContent != "" && oldContent != contentKey {
			decision = ""
		}
		if decision != "" {
			state = "obsolete"
		}
		existing := suggestExisting(ctx, tx, libraryID, nt, na)
		reasonJSON, _ := json.Marshal(reasons)
		_, err = tx.ExecContext(ctx, `INSERT INTO import_groups(id,library_id,logical_key,content_key,state,confidence,proposed_title,proposed_author,normalized_title,normalized_author,reasons_json,existing_work_id,revision,created_at,updated_at,decision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(library_id,logical_key) DO UPDATE SET content_key=excluded.content_key,state=excluded.state,confidence=excluded.confidence,proposed_title=excluded.proposed_title,proposed_author=excluded.proposed_author,normalized_title=excluded.normalized_title,normalized_author=excluded.normalized_author,reasons_json=excluded.reasons_json,existing_work_id=excluded.existing_work_id,revision=excluded.revision,updated_at=excluded.updated_at,decision=excluded.decision`, id, libraryID, logical, contentKey, state, confidence, first.Title, first.Author, nt, na, string(reasonJSON), nullValue(existing), revision, now, now, decision)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM import_items WHERE group_id=?`, id); err != nil {
			return err
		}
		duplicates := map[string]string{}
		for _, item := range items {
			kind := "audiobook"
			if item.Kind == "epub" {
				kind = "epub"
			}
			label := "EPUB edition"
			if kind == "audiobook" {
				label = "Audiobook"
				tags, _ := item.Metadata["tags"].(map[string]any)
				if narrator := metadataString(tags, "narrator"); narrator != "" {
					label += " narrated by " + narrator
				}
			}
			duplicate := duplicates[item.Hash]
			if duplicate == "" {
				duplicates[item.Hash] = item.ID
			}
			series, seriesPosition, narrators := catalogMetadata(item.Metadata)
			evidence, _ := json.Marshal(map[string]any{"series": series, "series_position": seriesPosition, "narrators": narrators, "raw_title": item.Title, "raw_author": item.Author, "normalized_title": normalize(item.Title), "normalized_author": normalize(item.Author), "relative_path": item.Path, "sha256": item.Hash, "kind": kind, "advisory_title": item.AdvisoryTitle, "advisory_author": item.AdvisoryAuthor, "advisory_isbn": item.AdvisoryISBN, "advisory_year": item.AdvisoryYear, "advisory_cover_url": item.AdvisoryCover, "advisory_source": "open_library"})
			if _, err = tx.ExecContext(ctx, `INSERT INTO import_items(group_id,source_entry_id,representation_kind,proposed_label,duplicate_of_entry_id,evidence_json) VALUES(?,?,?,?,?,?)`, id, item.ID, kind, label, nullValue(duplicate), string(evidence)); err != nil {
				return err
			}
		}
		seen[logical] = true
	}
	for key := range seen {
		if _, err = tx.ExecContext(ctx, `UPDATE import_groups SET state=CASE WHEN confidence='high' THEN 'proposed' ELSE 'review_required' END WHERE library_id=? AND logical_key=? AND decision=''`, libraryID, key); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) Proposals(ctx context.Context, actor auth.User, libraryID string) ([]Proposal, error) {
	var allowed int
	args := append([]any{actor.ID, libraryID}, auth.LibraryEditArgs(actor)...)
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries l LEFT JOIN library_members lm ON lm.library_id=l.id AND lm.user_id=? WHERE l.id=? AND `+auth.EffectiveLibraryEditSQL("l.id", "lm"), args...).Scan(&allowed); err != nil || allowed != 1 {
		if err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,library_id,state,confidence,proposed_title,proposed_author,normalized_title,normalized_author,reasons_json,COALESCE(existing_work_id,''),revision,created_at,updated_at FROM import_groups WHERE library_id=? AND state!='obsolete' ORDER BY proposed_title,proposed_author,id`, libraryID)
	if err != nil {
		return nil, err
	}
	var out []Proposal
	for rows.Next() {
		var p Proposal
		var reasons, created, updated string
		if err := rows.Scan(&p.ID, &p.LibraryID, &p.State, &p.Confidence, &p.Title, &p.Author, &p.NormalizedTitle, &p.NormalizedAuthor, &reasons, &p.ExistingWorkID, &p.Revision, &created, &updated); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(reasons), &p.Reasons)
		p.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Items, err = s.proposalItems(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
func (s *Store) Proposal(ctx context.Context, actor auth.User, libraryID, id string) (Proposal, error) {
	values, err := s.Proposals(ctx, actor, libraryID)
	if err != nil {
		return Proposal{}, err
	}
	for _, value := range values {
		if value.ID == id {
			return value, nil
		}
	}
	return Proposal{}, ErrNotFound
}

func (s *Store) autoImportProposals(ctx context.Context, libraryID, sourceID, scanID string) (int, error) {
	var enabled bool
	if err := s.db.QueryRowContext(ctx, `SELECT auto_import FROM library_sources WHERE id=? AND library_id=? AND enabled=1 AND deleted_at IS NULL`, sourceID, libraryID).Scan(&enabled); err != nil || !enabled {
		if errors.Is(err, sql.ErrNoRows) || err == nil {
			return 0, nil
		}
		return 0, err
	}
	proposals, err := s.Proposals(ctx, auth.User{Admin: true}, libraryID)
	if err != nil {
		return 0, err
	}
	imported := 0
	for _, proposal := range proposals {
		if proposal.Confidence != "high" || proposal.State != "proposed" || proposal.ExistingWorkID != "" {
			continue
		}
		var mismatches int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE i.group_id=? AND (e.source_id!=? OR e.last_seen_scan_id!=?)`, proposal.ID, sourceID, scanID).Scan(&mismatches); err != nil {
			return imported, err
		}
		if mismatches != 0 {
			continue
		}
		items := make([]AcceptItem, len(proposal.Items))
		for i, item := range proposal.Items {
			items[i] = AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label}
		}
		if _, err := s.AcceptProposal(ctx, auth.User{Admin: true}, libraryID, proposal.ID, AcceptRequest{ExpectedRevision: proposal.Revision, Title: proposal.Title, Author: proposal.Author, Items: items}); err != nil {
			return imported, err
		}
		imported++
	}
	return imported, nil
}
func (s *Store) proposalItems(ctx context.Context, id string) ([]ProposalItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT i.source_entry_id,e.relative_path,i.representation_kind,i.proposed_label,e.sha256,COALESCE(i.duplicate_of_entry_id,''),i.evidence_json FROM import_items i JOIN source_entries e ON e.id=i.source_entry_id WHERE i.group_id=? ORDER BY i.representation_kind,e.relative_path,e.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProposalItem
	for rows.Next() {
		var v ProposalItem
		var evidence string
		if err := rows.Scan(&v.EntryID, &v.RelativePath, &v.Kind, &v.Label, &v.SHA256, &v.DuplicateOf, &evidence); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(evidence), &v.Evidence)
		out = append(out, v)
	}
	return out, rows.Err()
}
func normalize(value string) string {
	value = norm.NFKC.String(strings.ToLower(strings.TrimSpace(value)))
	var b strings.Builder
	space := false
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
		} else {
			space = true
		}
	}
	return b.String()
}
func identityMetadata(e proposalEntry) (string, string) {
	if e.Kind == "epub" {
		return metadataString(e.Metadata, "title"), firstString(e.Metadata["creators"])
	}
	tags, _ := e.Metadata["tags"].(map[string]any)
	title := metadataString(tags, "album")
	if title == "" {
		title = metadataString(tags, "title")
	}
	author := metadataString(tags, "album_artist")
	if author == "" {
		author = metadataString(tags, "artist")
	}
	return title, author
}
func metadataString(values map[string]any, key string) string {
	if v, ok := values[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}
func firstString(value any) string {
	if values, ok := value.([]any); ok && len(values) > 0 {
		if v, ok := values[0].(string); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
func suggestExisting(ctx context.Context, tx *sql.Tx, libraryID, title, author string) string {
	rows, err := tx.QueryContext(ctx, `SELECT id,title,COALESCE(author,'') FROM works WHERE library_id=? ORDER BY id`, libraryID)
	if err != nil {
		return ""
	}
	defer rows.Close()
	match := ""
	for rows.Next() {
		var id, t, a string
		if rows.Scan(&id, &t, &a) == nil && normalize(t) == title && normalize(a) == author {
			if match != "" {
				return ""
			}
			match = id
		}
	}
	if rows.Err() != nil {
		return ""
	}
	return match
}
func nullValue(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func mustJSON(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}
func sameKindVariants(items []proposalEntry) bool {
	seen := map[string]map[string]bool{}
	for _, item := range items {
		if seen[item.Kind] == nil {
			seen[item.Kind] = map[string]bool{}
		}
		seen[item.Kind][item.Hash] = true
	}
	for _, hashes := range seen {
		if len(hashes) > 1 {
			return true
		}
	}
	return false
}
