package source

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestProposalAmbiguityDuplicatesAndExistingWorkSuggestion(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('source','library','local','Books','/books',1,?,?); INSERT INTO works(id,library_id,title,author,created_at,updated_at) VALUES('work','library','Known Book','Known Author',?,?)`, now, now, now, now, now, now, now, now)
	if err != nil {
		t.Fatal(err)
	}
	entries := []struct {
		id, kind, hash string
		metadata       map[string]any
	}{{"missing", "epub", "a", map[string]any{"title": "Mystery", "creators": []string{}}}, {"known", "epub", "b", map[string]any{"title": "Known Book", "creators": []string{"Known Author"}}}, {"dup1", "audio", "c", map[string]any{"tags": map[string]any{"album": "Duplicate", "artist": "Writer"}}}, {"dup2", "audio", "c", map[string]any{"tags": map[string]any{"album": "Duplicate", "artist": "Writer"}}}, {"conflict", "audio", "d", map[string]any{"tags": map[string]any{"album": "Known Book", "artist": "Other Author"}}}}
	for _, entry := range entries {
		metadata, _ := json.Marshal(entry.metadata)
		hash := entry.hash
		for len(hash) < 64 {
			hash += entry.hash
		}
		_, err = db.Exec(`INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,sha256,state,created_at,updated_at,detected_kind,metadata_json) VALUES(?,?,?,1,?,?, 'registered',?,?,?,?)`, entry.id, "source", entry.id, now, hash, now, now, entry.kind, string(metadata))
		if err != nil {
			t.Fatal(err)
		}
	}
	store, _ := New(db, Options{ManagedRoot: t.TempDir()})
	if err := store.GenerateProposals(ctx, "library"); err != nil {
		t.Fatal(err)
	}
	proposals, err := store.Proposals(ctx, auth.User{ID: "admin", Admin: true}, "library")
	if err != nil {
		t.Fatal(err)
	}
	if len(proposals) != 4 {
		t.Fatalf("proposals=%d: %+v", len(proposals), proposals)
	}
	for _, proposal := range proposals {
		switch proposal.Title {
		case "Mystery":
			if proposal.State != "review_required" || proposal.Confidence != "low" {
				t.Fatalf("missing author=%+v", proposal)
			}
		case "Known Book":
			if proposal.Author == "Known Author" && proposal.ExistingWorkID != "work" {
				t.Fatalf("existing suggestion=%+v", proposal)
			}
		case "Duplicate":
			if len(proposal.Items) != 2 || proposal.Items[1].DuplicateOf == "" {
				t.Fatalf("duplicates=%+v", proposal)
			}
		}
	}
}

func TestNormalizeUnicodeCaseWhitespaceAndPunctuation(t *testing.T) {
	if got := normalize("  Ａlice’s—Book! "); got != "alice s book" {
		t.Fatalf("normalize=%q", got)
	}
}
