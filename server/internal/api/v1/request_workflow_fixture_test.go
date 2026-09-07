package v1

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/collection"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/notification"
	"github.com/mahcks/aldus/server/internal/position"
	"github.com/mahcks/aldus/server/internal/source"
)

// Started only by request-workflow.e2e.ts. No fixture controls enter the production router.
func TestRequestWorkflowFixture(t *testing.T) {
	if os.Getenv("ALDUS_REQUEST_E2E") != "1" {
		t.Skip("Playwright owns this disposable service")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	root := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(root, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	owner, err := accounts.Setup(ctx, auth.Credentials{Username: "owner", Password: "fixture-password-123"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
		SELECT 'reader','reader','reader','Sam',password_hash,0,0,created_at,updated_at FROM users WHERE id=?`, owner.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := accounts.Login(ctx, auth.Credentials{Username: "reader", Password: "fixture-password-123"})
	if err != nil {
		t.Fatal(err)
	}
	sources, err := source.New(db, source.Options{DataRoot: root, ManagedRoot: filepath.Join(root, "media"), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"family", "review", "retry"} {
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := db.ExecContext(ctx, `INSERT INTO libraries(id,name,created_at,updated_at) VALUES(?,?,?,?)`, id, strings.ToUpper(id[:1])+id[1:], stamp, stamp); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO library_members(library_id,user_id,role,can_request_acquisitions,created_at) VALUES(?,'reader','reader',1,?)`, id, stamp); err != nil {
			t.Fatal(err)
		}
	}
	if err := sources.EnsureManagedSources(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE library_sources SET auto_import=0 WHERE library_id='review'`); err != nil {
		t.Fatal(err)
	}
	if err := sources.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); sources.Wait() }()
	fixture, err := os.ReadFile("../../../../test-fixtures/alice/media/alice.epub")
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(fixture), int64(len(fixture)))
	if err != nil {
		t.Fatal(err)
	}
	var variant bytes.Buffer
	writer := zip.NewWriter(&variant)
	for _, item := range archive.File {
		input, err := item.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(input)
		input.Close()
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(item.Name, ".opf") {
			content = append(content, '\n')
		}
		output, err := writer.CreateHeader(&item.FileHeader)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := output.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	ingress := filepath.Join(root, "downloads")
	if err := os.MkdirAll(ingress, 0o700); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var downloads []map[string]any
	adds := 0
	failPayload := false
	manualReview := false
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/indexer":
			fmt.Fprint(w, `<rss><channel><item><title>Alice's Adventures in Wonderland Lewis Carroll English EPUB</title><enclosure url="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567" length="204800"/></item></channel></rss>`)
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "fixture"})
			fmt.Fprint(w, "Ok.")
		case "/api/v2/torrents/add":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			adds++
			hash := fmt.Sprintf("%040d", adds)
			payload := filepath.Join(ingress, hash)
			if !failPayload {
				if err := os.MkdirAll(payload, 0o700); err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
				if err := os.WriteFile(filepath.Join(payload, "book.epub"), fixture, 0o600); err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
			}
			if manualReview {
				if err := os.WriteFile(filepath.Join(payload, "other-edition.epub"), variant.Bytes(), 0o600); err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
			}
			downloads = append(downloads, map[string]any{"hash": hash, "name": "Alice", "state": "stoppedUP", "progress": 1, "content_path": "/downloads/" + hash, "tags": r.FormValue("tags"), "size": len(fixture)})
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(map[string]any{"added_torrent_ids": []string{hash}, "failure_count": 0, "success_count": 1, "pending_count": 0})
		case "/api/v2/torrents/info":
			json.NewEncoder(w).Encode(downloads)
		case "/api/v2/torrents/removeTags":
			w.WriteHeader(200)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	client, err := acquisition.New(acquisition.Options{IndexerKind: "torznab", IndexerURL: provider.URL + "/indexer", QBitURL: provider.URL, DownloadRoot: "/downloads"})
	if err != nil {
		t.Fatal(err)
	}
	acquisitions := acquisition.NewStore(db, client)
	acquisitions.SetDownloadIngress(ingress)
	acquisitions.SetHandoff(sources.EnqueueAcquisitionScan)
	acquisitions.SetScanRetry(sources.RetryAcquisitionScan)
	titles := acquisition.NewTitleRequestStore(db)
	titles.SetAcquisitionStore(acquisitions)
	inbox := notification.New(db)
	titles.SetNotificationStore(inbox)
	media, err := ingest.New(db, ingest.Options{Root: root, Resolver: sources, MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	policies := acquisition.NewPolicyStore(db)
	for _, id := range []string{"family", "review", "retry"} {
		policy, err := policies.Get(ctx, owner.User, id)
		if err != nil {
			t.Fatal(err)
		}
		policy.DefaultEbookSourceID = "managed-" + id
		policy.MaxActiveRequests = 1
		if _, err := policies.Update(ctx, owner.User, policy); err != nil {
			t.Fatal(err)
		}
	}
	alignments, err := alignment.New(db, alignment.Options{MediaRoot: root, ArtifactRoot: filepath.Join(root, "alignments"), Command: []string{"false"}, Timeout: time.Minute, Media: sources})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(Dependencies{AlignmentJobs: alignments, Auth: accounts, Catalog: catalog.New(db), Collections: collection.New(db), Position: position.New(db), Ingest: media, Sources: sources, Acquisitions: acquisitions, AcquisitionPolicies: policies, TitleRequests: titles, Notifications: inbox})
	stopped := make(chan struct{})
	var stop sync.Once
	mux := http.NewServeMux()
	mux.Handle("/api/v1/", http.StripPrefix("/api/v1", handler))
	mux.HandleFunc("/tick", func(w http.ResponseWriter, r *http.Request) {
		if err := titles.Poll(ctx); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if err := acquisitions.Poll(ctx); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if err := titles.Poll(ctx); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("/payload", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		failPayload = r.URL.Query().Get("fail") == "true"
		manualReview = r.URL.Query().Get("review") == "true"
		if !failPayload {
			for _, download := range downloads {
				payload := filepath.Join(ingress, download["hash"].(string))
				if err := os.MkdirAll(payload, 0o700); err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
				if err := os.WriteFile(filepath.Join(payload, "book.epub"), fixture, 0o600); err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
			}
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		json.NewEncoder(w).Encode(map[string]int{"adds": adds})
	})
	mux.HandleFunc("/stop", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204); stop.Do(func() { close(stopped) }) })
	server := httptest.NewServer(mux)
	defer server.Close()
	metadata, _ := json.Marshal(map[string]string{"url": server.URL, "reader": reader.Token, "owner": owner.Token})
	fmt.Println("ALDUS_REQUEST_FIXTURE=" + string(metadata))
	select {
	case <-stopped:
	case <-time.After(10 * time.Minute):
		t.Fatal("browser did not stop request fixture")
	}
}
