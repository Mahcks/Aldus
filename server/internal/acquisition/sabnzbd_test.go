package acquisition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

// A local API fixture owns all jobs. It never contacts an indexer or NNTP server.
type sabFixture struct {
	mu          sync.Mutex
	jobs        []sabJob
	uploads     int
	retries     int
	deletes     int
	loseReceipt bool
}

func (f *sabFixture) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/release" {
		fmt.Fprint(w, `<nzb><file subject="Alice.epub"><segments><segment bytes="10" number="1">local-fixture@aldus.invalid</segment></segments></file></nzb>`)
		return
	}

	if r.URL.Path == "/feed" {
		fmt.Fprint(w, `<rss><channel><item><title>Alice EPUB</title><enclosure url="/release" type="application/x-nzb" length="1024" /></item></channel></rss>`)
		return
	}

	_ = r.ParseMultipartForm(1 << 20)
	f.mu.Lock()
	defer f.mu.Unlock()

	if r.FormValue("apikey") != "test-key" {
		fmt.Fprint(w, `{"status":false,"error":"API Key Incorrect"}`)
		return
	}

	switch r.FormValue("mode") {
	case "addfile":
		f.uploads++
		f.jobs = []sabJob{{
			ID:         "SABnzbd_nzo_fixture",
			Filename:   r.FormValue("nzbname"),
			State:      "Downloading",
			Percentage: "25",
		}}
		if f.loseReceipt {
			fmt.Fprint(w, `{`)
			return
		}
		fmt.Fprint(w, `{"status":true,"nzo_ids":["SABnzbd_nzo_fixture"]}`)
	case "retry":
		f.retries++
		f.jobs[0].State = "Downloading"
		f.jobs[0].ID = "fb34035d-bd39-452e-9fdc-349eec67bb6e"
		fmt.Fprint(w, `{"status":true,"nzo_id":"fb34035d-bd39-452e-9fdc-349eec67bb6e"}`)
	case "queue", "history":
		if r.FormValue("name") == "delete" {
			if r.FormValue("value") != f.jobs[0].ID || r.FormValue("del_files") != "0" {
				panic("unsafe cancellation")
			}

			f.deletes++
			f.jobs = nil
			fmt.Fprint(w, `{"status":true,"nzo_ids":["SABnzbd_nzo_fixture"]}`)
			return
		}
		var jobs []sabJob
		for _, job := range f.jobs {
			queued := job.State == "Downloading" || job.State == "Paused"
			if (r.FormValue("mode") == "queue") == queued {
				jobs = append(jobs, job)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{r.FormValue("mode"): sabPage{Slots: jobs}})
	default:
		http.Error(w, "unsupported fixture operation", 400)
	}
}

func TestSABnzbdRequestSurvivesRestartAndWaitsForPostProcessing(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	fixture := &sabFixture{loseReceipt: true}
	server := httptest.NewServer(http.HandlerFunc(fixture.serve))
	defer server.Close()

	options := Options{
		IndexerKind:         "newznab",
		IndexerURL:          server.URL + "/feed",
		SABnzbdURL:          server.URL,
		SABnzbdAPIKey:       "test-key",
		SABnzbdDownloadRoot: "/completed",
	}
	client, err := New(options)
	if err != nil {
		t.Fatal(err)
	}

	store := NewStore(db, client)
	actor := auth.User{ID: "reader", Admin: true}
	results, err := store.Search(ctx, actor, "library", "legacy")
	if err != nil || len(results) != 1 || results[0].Metadata.Protocol != "usenet" {
		t.Fatalf("search=%+v err=%v", results, err)
	}

	request, err := store.Select(ctx, actor, "library", "legacy", results[0].ID)
	if err != nil || request.FulfillmentState != "downloading" {
		t.Fatalf("selection=%+v err=%v", request, err)
	}

	// Restart with no default client: the selected client's durable record is authoritative.
	replacement, _ := New(Options{})
	store = NewStore(db, replacement)
	root := t.TempDir()
	if _, err := db.Exec(`UPDATE library_sources SET root_path=? WHERE id='source'`, root); err != nil {
		t.Fatal(err)
	}

	handoffs := 0
	store.SetHandoff(func(_ context.Context, library, source, request, path string) (string, error) {
		handoffs++
		if path != filepath.Join(root, "Alice") {
			t.Fatalf("wrong import path %q", path)
		}

		_, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,acquisition_request_id) VALUES('scan',?,'pending','2026-01-01',?)`, source, request)
		return "scan", err
	})
	for _, state := range []string{"Verifying", "Repairing", "Extracting", "Moving", "Running", "Completed"} {
		fixture.mu.Lock()
		fixture.jobs[0].State = state
		fixture.jobs[0].Storage = "/completed/Alice"
		fixture.mu.Unlock()
		if err := store.Poll(ctx); err != nil {
			t.Fatal(err)
		}

		expected := 0
		if state == "Completed" {
			expected = 1
		}

		if handoffs != expected {
			t.Fatalf("state=%s imports=%d", state, handoffs)
		}
	}

	if fixture.uploads != 1 {
		t.Fatalf("duplicate submissions: %d", fixture.uploads)
	}

	request, err = store.request(ctx, "legacy")
	if err != nil || request.FulfillmentState != "scanning" || request.DownloadClientKind != "sabnzbd" {
		t.Fatalf("handoff=%+v err=%v", request, err)
	}
}

func TestSABnzbdUnknownSubmissionNeverAutomaticallyResubmits(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	fixture := &sabFixture{}
	server := httptest.NewServer(http.HandlerFunc(fixture.serve))
	defer server.Close()

	client, _ := New(Options{SABnzbdURL: server.URL, SABnzbdAPIKey: "test-key"})
	store := NewStore(db, client)
	_, err := db.Exec(`UPDATE acquisition_requests SET fulfillment_state='submitting',selected_url=?,selected_release_metadata='{"protocol":"usenet"}',updated_at=? WHERE id='legacy'`, server.URL+"/release", time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano))
	if err != nil {
		t.Fatal(err)
	}

	if err := store.recoverSubmissions(ctx); err != nil {
		t.Fatal(err)
	}

	if fixture.uploads != 0 {
		t.Fatal("ambiguous submission uploaded again")
	}

	request, err := store.request(ctx, "legacy")
	if err != nil || request.FulfillmentState != "failed" {
		t.Fatalf("request=%+v err=%v", request, err)
	}

	if err := store.Retry(ctx, auth.User{ID: "reader", Admin: true}, "library", "legacy"); err == nil {
		t.Fatal("missing history silently resubmitted")
	}
}

func TestSABnzbdRetryAndCancellationUseOriginalJob(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	fixture := &sabFixture{jobs: []sabJob{{ID: "SABnzbd_nzo_fixture", Name: "aldus-legacy", State: "Failed"}}}
	server := httptest.NewServer(http.HandlerFunc(fixture.serve))
	defer server.Close()

	client, _ := New(Options{SABnzbdURL: server.URL, SABnzbdAPIKey: "test-key"})
	store := NewStore(db, client)
	_, err := db.Exec(`UPDATE acquisition_requests SET fulfillment_state='failed',selected_url=?,selected_release_metadata='{"protocol":"usenet"}',download_job_id='SABnzbd_nzo_fixture',torrent_ownership='created' WHERE id='legacy'`, server.URL+"/release")
	if err != nil {
		t.Fatal(err)
	}

	actor := auth.User{ID: "reader", Admin: true}
	if _, err := store.UpdateSettings(ctx, actor, SettingsUpdate{}); err != nil {
		t.Fatal(err)
	}

	if err := store.Retry(ctx, actor, "library", "legacy"); err != nil {
		t.Fatal(err)
	}

	if err := store.Cancel(ctx, actor, "library", "legacy"); err != nil {
		t.Fatal(err)
	}

	if fixture.retries != 1 || fixture.deletes != 1 || fixture.uploads != 0 {
		t.Fatalf("retry=%d delete=%d upload=%d", fixture.retries, fixture.deletes, fixture.uploads)
	}
}

func TestSABnzbdUnavailableDoesNotAcceptUsenetSelection(t *testing.T) {
	db := titleLifecycleFixture(t)
	_, err := db.Exec(`UPDATE acquisition_results SET release_metadata='{"protocol":"usenet"}'`)
	if err != nil {
		t.Fatal(err)
	}

	client, _ := New(Options{})
	store := NewStore(db, client)
	_, err = store.Select(context.Background(), auth.User{ID: "reader", Admin: true}, "library", "legacy", "release")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing client: %v", err)
	}
}

func TestSABnzbdSettingsPreserveOldClientsAndSecrets(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	client, _ := New(Options{})
	store := NewStore(db, client)
	actor := auth.User{ID: "reader", Admin: true}
	update := SettingsUpdate{
		IndexerKind:         "newznab",
		IndexerURL:          "http://indexer/api",
		SABnzbdURL:          "http://sab",
		SABnzbdAPIKey:       "first-key",
		SABnzbdDownloadRoot: "/complete",
	}
	if _, err := store.UpdateSettings(ctx, actor, update); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`UPDATE acquisition_requests SET selected_url='http://indexer/nzb',selected_release_metadata='{"protocol":"usenet"}'`); err != nil {
		t.Fatal(err)
	}
	// An older client can save unrelated acquisition settings without removing Usenet.
	if _, err := store.UpdateSettings(ctx, actor, SettingsUpdate{PreserveSABnzbd: true}); err != nil {
		t.Fatal(err)
	}

	settings, err := store.Settings(ctx, actor)
	if err != nil || settings.SABnzbdURL != "http://sab" || !settings.HasSABnzbdAPIKey {
		t.Fatalf("legacy update erased SABnzbd: %+v %v", settings, err)
	}

	update.SABnzbdAPIKey = "rotated-key"
	update.SABnzbdDownloadRoot = "/new"
	if _, err := store.UpdateSettings(ctx, actor, update); err != nil {
		t.Fatal(err)
	}

	bound, _, err := store.requestClient(ctx, "legacy")
	if err != nil || bound.options.SABnzbdAPIKey != "rotated-key" || bound.options.DownloadRoot != "/complete" {
		t.Fatalf("binding/rotation: %+v %v", bound, err)
	}
}

func TestSABnzbdDoesNotForwardIndexerKeyToAnotherOrigin(t *testing.T) {
	var leaked string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = r.Header.Get("X-Api-Key")
		fmt.Fprint(w, `<html>not an NZB</html>`)
	}))
	defer provider.Close()

	client, _ := New(Options{
		IndexerURL:    "http://indexer.invalid",
		IndexerAPIKey: "private-key",
		downloadKind:  "sabnzbd",
	})
	_, err := client.submitTracked(context.Background(), provider.URL, "legacy")
	if err == nil || leaked != "" {
		t.Fatalf("invalid payload or leaked key: %q %v", leaked, err)
	}

	for _, id := range []string{"all", "ALL", "*", "a,b", ""} {
		if validSABJobID(id) {
			t.Fatalf("unsafe job ID accepted: %q", id)
		}
	}
}

func TestProwlarrSearchKeepsTorrentAndUsenetRoutesDistinct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/indexer":
			fmt.Fprint(w, `[{"id":1,"name":"Torrent books","enable":true,"protocol":"torrent"},{"id":2,"name":"Usenet books","enable":true,"protocol":"usenet"}]`)
		case "/1/api":
			fmt.Fprint(w, `<rss><channel><item><title>Alice EPUB</title><enclosure url="/alice.torrent" type="application/x-bittorrent" /></item></channel></rss>`)
		case "/2/api":
			fmt.Fprint(w, `<rss><channel><item><title>Alice EPUB</title><enclosure url="/alice.nzb" type="application/x-nzb" /></item></channel></rss>`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, _ := New(Options{
		IndexerKind: "prowlarr",
		IndexerURL:  server.URL,
		QBitURL:     server.URL,
		SABnzbdURL:  server.URL,
	})
	report, err := client.SearchReport(context.Background(), "Alice")
	if err != nil || len(report.Results) != 2 {
		t.Fatalf("mixed search: %+v %v", report, err)
	}

	protocols := map[string]int{}
	for _, result := range report.Results {
		protocols[result.Metadata.Protocol]++
	}

	if protocols["torrent"] != 1 || protocols["usenet"] != 1 {
		t.Fatalf("transport identity lost: %+v", protocols)
	}
}
