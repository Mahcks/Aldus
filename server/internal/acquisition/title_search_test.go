package acquisition

import (
	"context"
	"io"
	"net/http"
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
	if alice.WorkID != local.ID || alice.ExternalID != "OL1W" || alice.CoverURL != "/api/media/alice-epub/cover" || !alice.Readable || alice.EbookRequestState != "wanted" || alice.AudiobookRequestState != "pending_approval" {
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
	// The local request must never wait for or contact the external provider.
	calls := 0
	acquisitionStore.client = &Client{http: &http.Client{Transport: metadataRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}}
	report, err := acquisitionStore.SearchTitleReport(ctx, auth.User{ID: "reader"}, "Alice", true)
	if err != nil || calls != 0 || len(report.Results) != 1 || report.ExternalStatus != "not_requested" {
		t.Fatalf("local-only search: %#v %v calls=%d", report, err, calls)
	}
	report, err = acquisitionStore.SearchTitleReport(ctx, auth.User{ID: "reader"}, "Alice", false)
	if err != nil || len(report.Results) != 1 || report.ExternalStatus != "unavailable" {
		t.Fatalf("provider outage lost local results: %#v %v", report, err)
	}

	if _, err := db.Exec(`UPDATE library_members SET role='owner' WHERE library_id='visible' AND user_id='reader'`); err != nil {
		t.Fatal(err)
	}
	next, err := store.CreateWork(ctx, auth.User{ID: "reader"}, "visible", "Through the Looking Glass", "Lewis Carroll")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE works SET series_name='Wonderland',series_key='wonderland',series_order=1000 WHERE id=?`, local.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE works SET series_name='Wonderland',series_key='wonderland',series_order=2000 WHERE id=?`, next.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO representation_state(user_id,representation_id,epub_locator,revision,updated_at) VALUES('reader',?,'{}',1,'2026-01-03')`, representation.ID); err != nil {
		t.Fatal(err)
	}
	for _, workID := range []string{local.ID, next.ID} {
		rep, err := store.CreateRepresentation(ctx, auth.User{ID: "reader"}, workID, "audio", "Audiobook")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,storage_kind,created_at) VALUES(?,?,'audio','audio.m4b',?,'managed','2026-01-01')`, rep.ID, rep.ID, strings.Repeat("a", 64)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO representation_narrators(representation_id,ordinal,name,name_key) VALUES(?,0,'Shared Narrator','shared narrator')`, rep.ID); err != nil {
			t.Fatal(err)
		}
	}
	sections, err := acquisitionStore.localDiscoverySections(ctx, auth.User{ID: "reader"}, "")
	if err != nil || len(sections) != 3 {
		t.Fatalf("local discovery: %#v %v", sections, err)
	}
	for _, section := range sections {
		if len(section.Items) != 1 || section.Items[0].WorkID != next.ID {
			t.Fatalf("unrelated or unavailable recommendation: %#v", section)
		}
	}
	sections, err = acquisitionStore.localDiscoverySections(ctx, auth.User{ID: "other"}, "")
	if err != nil || len(sections) != 0 {
		t.Fatalf("private suggestions leaked: %#v %v", sections, err)
	}

}
