package acquisition

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestTitleSearchMergesExactStableMatchesAndIsolatesRequests(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('other','other','other','Other','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('visible','Visible','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('private','Private','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('visible','reader','owner','2026-01-01T00:00:00Z'),('private','other','owner','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	store := catalog.New(db)
	local, err := store.CreateWork(ctx, auth.User{ID: "reader"}, "visible", "Alice's Adventures in Wonderland", "Lewis Carroll")
	if err != nil {
		t.Fatal(err)
	}
	representation, err := store.CreateRepresentation(ctx, auth.User{ID: "reader"}, local.ID, "epub", "EPUB")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,storage_kind,created_at) VALUES('alice-epub',?,'epub','alice.epub',?,'managed','2026-01-01T00:00:00Z')`, representation.ID, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE library_members SET role='reader' WHERE library_id='visible' AND user_id='reader'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO title_requests(id,library_id,requested_by,work_id,external_source,external_id,title,author,cover_url,created_at,updated_at) VALUES('visible-request','visible','reader',?,'open_library','OL1W','Alice''s Adventures in Wonderland','Lewis Carroll','','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z'),('private-request','private','other',NULL,'open_library','OL9W','Alice''s Adventures in Wonderland','Lewis Carroll','','2026-01-03T00:00:00Z','2026-01-03T00:00:00Z'); INSERT INTO title_request_formats(title_request_id,format,state,created_at,updated_at) VALUES('visible-request','ebook','wanted','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z'),('visible-request','audiobook','pending_approval','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z'),('private-request','ebook','failed','2026-01-03T00:00:00Z','2026-01-03T00:00:00Z')`, local.ID); err != nil {
		t.Fatal(err)
	}
	acquisitionStore := NewStore(db, nil)
	results, err := acquisitionStore.searchTitles(ctx, auth.User{ID: "reader"}, "Alice", []Metadata{{ID: "OL1W", Title: "Alice's Adventures in Wonderland", Author: "Lewis Carroll", CoverURL: "cover"}, {ID: "OL2W", Title: "Dune", Author: "Frank Herbert"}, {ID: "OL3W", Title: "Dune", Author: "Frank Herbert"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 {
		t.Fatalf("results = %#v", results)
	}
	alice := results[0]
	if alice.WorkID != local.ID || alice.ExternalID != "OL1W" || alice.CoverURL != "cover" || !alice.Readable || alice.EbookRequestState != "wanted" || alice.AudiobookRequestState != "pending_approval" {
		t.Fatalf("merged Alice = %#v", alice)
	}
	if results[1].ExternalID == results[2].ExternalID || results[1].Title != "Dune" || results[2].Title != "Dune" {
		t.Fatalf("ambiguous editions = %#v", results[1:])
	}
	for _, result := range results {
		if result.EbookRequestState == "failed" || result.ExternalID == "OL9W" {
			t.Fatalf("private request leaked = %#v", result)
		}
	}
}
