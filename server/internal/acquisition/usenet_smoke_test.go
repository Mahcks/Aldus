package acquisition

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/source"
)

func TestDisposableUsenetSmoke(t *testing.T) {
	raw := os.Getenv("ALDUS_USENET_SMOKE_URL")
	data := os.Getenv("ALDUS_USENET_SMOKE_DATA")
	container := os.Getenv("ALDUS_USENET_SMOKE_CONTAINER")
	if raw == "" {
		t.Skip("run scripts/acquisition-usenet-smoke.sh")
	}

	if !strings.HasPrefix(raw, "http://127.0.0.1:") || !strings.HasPrefix(container, "aldus-usenet-smoke-") || !strings.HasPrefix(data, "/tmp/aldus-usenet-smoke.") {
		t.Fatal("disposable fixture required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	payload, err := os.ReadFile("../../../test-fixtures/alice/media/alice.epub")
	if err != nil {
		t.Fatal(err)
	}

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file poster="fixture" date="1788800000" subject='"alice.epub" yEnc (1/1)'><groups><group>alt.test</group></groups><segments><segment bytes="%d" number="1">aldus-local@fixture.invalid</segment></segments></file></nzb>`, len(payload))
	}))
	defer provider.Close()

	client, err := New(Options{
		IndexerURL:          provider.URL,
		SABnzbdURL:          raw,
		SABnzbdAPIKey:       "0123456789abcdef0123456789abcdef",
		SABnzbdDownloadRoot: "/downloads",
		downloadKind:        "sabnzbd",
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
	_, err = db.Exec(`UPDATE acquisition_results SET download_url=?,release_metadata='{"protocol":"usenet"}' WHERE id='release'`, provider.URL+"/alice.nzb")
	if err != nil {
		t.Fatal(err)
	}

	store := NewStore(db, client)
	actor := auth.User{ID: "reader", Admin: true}
	selected, err := store.Select(ctx, actor, "library", "legacy", "release")
	if err != nil || (selected.FulfillmentState != "downloading" && selected.FulfillmentState != "submitting") {
		t.Fatalf("submission=%+v err=%v", selected, err)
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
				t.Fatalf("SABnzbd failed fixture download: %+v", job)
			}

			if job.ReadyForImport() {
				completed = job
				return true
			}
		}

		return false
	})
	if err := store.recoverSubmissions(ctx); err != nil {
		t.Fatal(err)
	}

	// Restart SABnzbd before handing the persisted completed job to Aldus.
	if output, err := exec.CommandContext(ctx, "docker", "restart", container).CombinedOutput(); err != nil {
		t.Fatalf("restart: %s %v", output, err)
	}

	wait(func() bool { _, err := client.Downloads(ctx); return err == nil })
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

	saved, err := os.ReadFile(filepath.Join(managedRoot, "legacy", "file-000001.epub"))
	if err != nil || !bytes.Equal(saved, payload) {
		t.Fatalf("imported EPUB differs: %v", err)
	}

	relative, err := filepath.Rel("/downloads", completed.ContentPath)
	if err != nil {
		t.Fatal(err)
	}

	originalPath := filepath.Join(data, relative)
	if info, err := os.Stat(originalPath); err == nil && info.IsDir() {
		originalPath = filepath.Join(originalPath, "alice.epub")
	}

	original, err := os.ReadFile(originalPath)
	if err != nil || !bytes.Equal(original, payload) {
		t.Fatalf("original SABnzbd output changed: %v", err)
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
	if err != nil {
		t.Fatal(err)
	}

	if request.FulfillmentState == "needs_review" {
		proposals, err := sources.Proposals(ctx, actor, "library")
		if err != nil {
			t.Fatal(err)
		}

		for _, proposal := range proposals {
			if proposal.State != "proposed" {
				continue
			}

			items := make([]source.AcceptItem, len(proposal.Items))
			for i, item := range proposal.Items {
				items[i] = source.AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label}
			}

			_, err := sources.AcceptProposal(ctx, actor, "library", proposal.ID, source.AcceptRequest{
				AcquisitionRequestID: "legacy",
				ExpectedRevision:     proposal.Revision,
				Title:                proposal.Title,
				Author:               proposal.Author,
				Items:                items,
			})
			if err != nil {
				t.Fatal(err)
			}
		}

		if err := store.Poll(ctx); err != nil {
			t.Fatal(err)
		}
	}

	request, err = store.request(ctx, "legacy")
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

	t.Log("local NNTP download, restart recovery, exact managed copy, visible library book and ready family request verified")
}
