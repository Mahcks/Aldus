package source

import (
	"context"
	"encoding/json"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"path/filepath"
	"testing"
	"time"
)

func TestImportCatalogMetadata(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?)`, now, now, now, now)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub"), filepath.Join(root, "alice.epub"))
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice-chapter-01.mp3"), filepath.Join(root, "alice.mp3"))
	s, err := New(db, Options{AllowedRoots: []string{root}, ManagedRoot: t.TempDir(), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	actor := auth.User{ID: "admin", Admin: true}
	source, err := s.Create(ctx, actor, "library", "Books", root, false)
	if err != nil {
		t.Fatal(err)
	}
	runTestScan(t, s, source.ID, "scan")
	entries, err := s.Entries(ctx, actor, "library", source.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		var metadata map[string]any
		if err := json.Unmarshal(entry.Metadata, &metadata); err != nil {
			t.Fatal(err)
		}
		metadata["series"] = "Wonderland"
		metadata["series_index"] = "0"
		if entry.Kind == "audio" {
			tags := metadata["tags"].(map[string]any)
			tags["narrator"] = []string{"Jane Doe", "John Smith"}
		}
		raw, _ := json.Marshal(metadata)
		if _, err := db.Exec(`UPDATE source_entries SET metadata_json=? WHERE id=?`, string(raw), entry.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	proposals, err := s.Proposals(ctx, actor, "library")
	if err != nil || len(proposals) != 1 {
		t.Fatalf("%+v %v", proposals, err)
	}
	p := proposals[0]
	items := []AcceptItem{}
	for _, item := range p.Items {
		items = append(items, AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label})
	}
	id, err := s.AcceptProposal(ctx, actor, "library", p.ID, AcceptRequest{ExpectedRevision: p.Revision, Title: p.Title, Author: p.Author, Items: items})
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.New(db)
	work, err := c.Work(ctx, actor, id)
	if err != nil || work.Series != "Wonderland" || catalog.SeriesPosition(work.SeriesOrder) != "0" {
		t.Fatalf("work=%+v err=%v", work, err)
	}
	reps, err := c.Representations(ctx, actor, id, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, rep := range reps {
		if rep.Kind != "epub" && (len(rep.Narrators) != 2 || rep.Narrators[1] != "John Smith") {
			t.Fatalf("narrators=%+v", rep)
		}
	}
}

func TestImportSeriesConflictsAreNotGuessed(t *testing.T) {
	for _, values := range [][]map[string]any{
		{{"series": "A", "series_index": "1"}, {"series": "B", "series_index": "1"}},
		{{"series": "A", "series_index": "1"}, {"series": "A", "series_index": "2"}},
		{{"series": "A", "series_index": "bad"}},
	} {
		name, position, agrees := agreedSeries(values)
		if agrees || name != "" || position != "" {
			t.Fatal("conflict inferred")
		}
	}
	name, position, agrees := agreedSeries([]map[string]any{{"series": "A", "series_index": "1.50"}, {"series": "a", "series_index": "1.5"}, {}})
	if !agrees || name != "a" || position != "1.5" {
		t.Fatalf("%s %s %v", name, position, agrees)
	}
}

func TestInvalidNarratorEvidenceDoesNotEraseSeries(t *testing.T) {
	name, position, names := catalogMetadata(map[string]any{"series": "Chronicles", "series_index": "1", "tags": map[string]any{"narrator": []any{42}}})
	if name != "Chronicles" || position != "1" || names != nil {
		t.Fatalf("%q %q %v", name, position, names)
	}
}
