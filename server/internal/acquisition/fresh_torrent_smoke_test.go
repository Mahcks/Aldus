package acquisition

import (
	"bytes"
	"context"
	"crypto/sha1"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

func TestDisposableFreshTorrentSmoke(t *testing.T) {
	raw := os.Getenv("ALDUS_SEEDING_SMOKE_URL")
	data := os.Getenv("ALDUS_SEEDING_SMOKE_DATA")
	container := os.Getenv("ALDUS_SEEDING_SMOKE_CONTAINER")
	if raw == "" {
		t.Skip("run scripts/acquisition-seeding-smoke.sh")
	}

	if !strings.HasPrefix(raw, "http://127.0.0.1:") || !strings.HasPrefix(container, "aldus-seeding-smoke-") || !strings.HasPrefix(data, "/tmp/aldus-seeding-smoke.") {
		t.Fatal("disposable fixture required")
	}

	for _, extension := range []string{"epub", "mp3", "m4b"} {
		t.Run(extension, func(t *testing.T) { disposableTorrentFormat(t, raw, data, extension) })
	}
}

func disposableTorrentFormat(t *testing.T, raw, data, extension string) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	payload, err := os.ReadFile(filepath.Join(filepath.Dir(data), "fixture", "alice."+extension))
	if err != nil {
		t.Fatal(err)
	}

	name := "alice." + extension
	destination := filepath.Join(data, name)
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("download destination must be absent: %v", err)
	}

	const pieceLength = 256 << 10
	var pieces []byte
	for start := 0; start < len(payload); start += pieceLength {
		end := min(start+pieceLength, len(payload))
		piece := sha1.Sum(payload[start:end])
		pieces = append(pieces, piece[:]...)
	}

	info := fmt.Appendf(nil, "d6:lengthi%de4:name%d:%s12:piece lengthi%de6:pieces%d:", len(payload), len(name), name, pieceLength, len(pieces))
	info = append(info, pieces...)
	info = append(info, 'e')
	webseed := "http://127.0.0.1:8082/" + name
	torrent := append([]byte("d4:info"), info...)
	torrent = fmt.Appendf(torrent, "8:url-list%d:%se", len(webseed), webseed)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(torrent) }))
	defer provider.Close()

	client, err := New(Options{
		IndexerURL:   provider.URL,
		QBitURL:      raw,
		QBitUsername: "admin",
		QBitPassword: "aldus-smoke-only",
		Category:     "aldus-smoke",
		DownloadRoot: "/downloads",
	})
	if err != nil {
		t.Fatal(err)
	}

	wait := func(check func() bool) {
		t.Helper()
		timer := time.NewTicker(100 * time.Millisecond)
		defer timer.Stop()

		for !check() {
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-timer.C:
			}
		}
	}
	wait(func() bool { _, err := client.Downloads(ctx); return err == nil })
	db := titleLifecycleFixture(t)
	format := "ebook"
	kind := "epub"
	if extension != "epub" {
		format = "audiobook"
		kind = "audio"
	}
	if _, err := db.Exec(`
        UPDATE title_requests
        SET title='Alice''s Adventures in Wonderland', author='Lewis Carroll';
        UPDATE acquisition_requests
        SET advisory_title='Alice''s Adventures in Wonderland', advisory_author='Lewis Carroll';
        UPDATE title_request_formats SET format=?;
    `, format); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`UPDATE acquisition_results SET download_url=? WHERE id='release'`, provider.URL+"/alice-"+extension+".torrent")
	if err != nil {
		t.Fatal(err)
	}

	store := NewStore(db, client)
	actor := auth.User{ID: "reader", Admin: true}
	selected, err := store.Select(ctx, actor, "library", "legacy", "release")
	if err != nil || (selected.FulfillmentState != "downloading" && selected.FulfillmentState != "submitting") {
		t.Fatalf("submission=%+v err=%v", selected, err)
	}

	var jobID string
	if err := db.QueryRow(`SELECT download_job_id FROM acquisition_requests WHERE id='legacy'`).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	// Reconcile the family request just as the title worker does after submission.
	titles := NewTitleRequestStore(db)
	titles.SetAcquisitionStore(store)
	if err := titles.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	var completed Download
	wait(func() bool {
		jobs, err := client.Downloads(ctx)
		if err != nil {
			return false
		}

		for _, job := range jobs {
			if job.State == "failed" {
				t.Fatalf("qBittorrent failed fixture download: %+v", job)
			}

			if job.ReadyForImport() && job.JobID == jobID {
				completed = job
				return true
			}
		}

		return false
	})
	if err := store.recoverSubmissions(ctx); err != nil {
		t.Fatal(err)
	}

	sources, err := source.New(db, source.Options{DataRoot: t.TempDir(), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}

	destinations, err := sources.List(ctx, actor, "library")
	if err != nil {
		t.Fatal(err)
	}

	var managed, managedRoot string
	for _, destination := range destinations {
		if destination.StorageKind == "managed" {
			managed = destination.ID
			managedRoot = destination.RootPath
		}
	}

	if managed == "" {
		t.Fatal("managed source missing")
	}

	if _, err := db.Exec(`UPDATE acquisition_requests SET source_id=? WHERE id='legacy'`, managed); err != nil {
		t.Fatal(err)
	}

	store = NewStore(db, client)
	store.SetDownloadIngress(data)
	store.SetHandoff(sources.EnqueueAcquisitionScan)
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	saved, err := os.ReadFile(filepath.Join(managedRoot, "legacy", "file-000001."+extension))
	if err != nil || !bytes.Equal(saved, payload) {
		t.Fatalf("imported media differs: %v", err)
	}

	relative, err := filepath.Rel("/downloads", completed.ContentPath)
	if err != nil {
		t.Fatal(err)
	}

	originalPath := filepath.Join(data, relative)
	if info, err := os.Stat(originalPath); err == nil && info.IsDir() {
		originalPath = filepath.Join(originalPath, "alice."+extension)
	}

	original, err := os.ReadFile(originalPath)
	if err != nil || !bytes.Equal(original, payload) {
		t.Fatalf("original qBittorrent output changed: %v", err)
	}

	scanCtx, stopScans := context.WithCancel(ctx)
	if err := sources.Start(scanCtx); err != nil {
		stopScans()
		t.Fatal(err)
	}

	defer func() { stopScans(); sources.Wait() }()

	wait(func() bool {
		scans, err := sources.Scans(ctx, actor, "library", managed)
		if err != nil {
			t.Fatal(err)
		}

		if len(scans) == 0 {
			return false
		}

		if scans[0].State == "failed" {
			t.Fatalf("scan failed: %s", scans[0].Error)
		}

		return scans[0].State == "completed"
	})
	if err := store.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	request, err := store.request(ctx, "legacy")
	if err != nil || request.FulfillmentState != "available" || request.WorkID == "" {
		t.Fatalf("book did not become available: %+v %v", request, err)
	}

	titles.SetAcquisitionStore(store)
	if err := titles.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	title, err := titles.Get(ctx, actor, "library", "title")
	if err != nil || len(title.Formats) != 1 || title.Formats[0].State != "available" {
		t.Fatalf("family request did not become ready: %+v %v", title, err)
	}

	var imported int
	if err := db.QueryRow(`
        SELECT COUNT(*)
        FROM representations
        WHERE work_id=? AND kind=?
    `, request.WorkID, kind).Scan(&imported); err != nil || imported != 1 {
		t.Fatalf("requested representation count=%d: %v", imported, err)
	}
	t.Log("fresh local HTTP webseed transfer into empty destination, exact managed copy, automatic requested-format import and family availability verified")
}
