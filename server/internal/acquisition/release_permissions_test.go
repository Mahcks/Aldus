package acquisition

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestReleaseSubmissionPermissions(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
 INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
 VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01','2026-01-01');
 INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01');
 INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','reader','reader','2026-01-01');
 INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at)
 VALUES('source','library','local','Downloads','/downloads',1,'2026-01-01','2026-01-01');
 INSERT INTO acquisition_requests(id,library_id,requested_by,source_id,query,status,created_at,updated_at)
 VALUES('existing','library','reader','source','Alice','requested','2026-01-01','2026-01-01');
 INSERT INTO acquisition_results(id,request_id,title,download_url,source,size,created_at)
 VALUES('release','existing','Alice EPUB','magnet:?xt=urn:btih:0123456789012345678901234567890123456789','test',123,'2026-01-01');`)
	if err != nil {
		t.Fatal(err)
	}
	var adds atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test-session"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/add":
			adds.Add(1)
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/torrents/categories":
			_, _ = w.Write([]byte("{}"))
		default:
			_, _ = w.Write([]byte("[]"))
		}
	}))
	defer provider.Close()
	client, err := New(Options{IndexerURL: provider.URL + "/indexer", QBitURL: provider.URL})
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, client)
	for _, tc := range []struct {
		name                      string
		request, advanced, bypass bool
	}{
		{"no request", false, true, true}, {"request only", true, false, false},
		{"bypass only", true, false, true}, {"advanced needs approval", true, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := db.Exec("UPDATE library_members SET can_request_acquisitions=?,can_advanced_acquisition_request=?,can_bypass_acquisition_approval=?", tc.request, tc.advanced, tc.bypass)
			if err != nil {
				t.Fatal(err)
			}
			if !tc.request || !tc.advanced {
				if _, err := store.Create(ctx, auth.User{ID: "reader"}, "library", "source", "Alice"); !errors.Is(err, ErrNotFound) {
					t.Fatalf("raw create: %v", err)
				}
				if _, err := store.Search(ctx, auth.User{ID: "reader"}, "library", "existing"); !errors.Is(err, ErrNotFound) {
					t.Fatalf("raw search: %v", err)
				}
				if _, err := store.Discover(ctx, auth.User{ID: "reader"}, "library", "source", "Alice"); !errors.Is(err, ErrNotFound) {
					t.Fatalf("discovery: %v", err)
				}
			}
			store.discoveries["session"] = discoverySession{LibraryID: "library", SourceID: "source", UserID: "reader", ExpiresAt: time.Now().Add(time.Minute), Results: map[string]selectedDiscoveryResult{"one": {}, "two": {}}}
			if _, err := store.SelectDiscovery(ctx, auth.User{ID: "reader"}, "library", "session", "one"); !errors.Is(err, ErrNotFound) {
				t.Fatalf("discovery submission: %v", err)
			}
			if _, err := store.SelectPairDiscovery(ctx, auth.User{ID: "reader"}, "library", "session", []string{"one", "two"}); !errors.Is(err, ErrNotFound) {
				t.Fatalf("pair submission: %v", err)
			}
			if err := store.Retry(ctx, auth.User{ID: "reader"}, "library", "existing"); !errors.Is(err, ErrNotFound) {
				t.Fatalf("retry submission: %v", err)
			}
			actor := auth.User{ID: "reader", Admin: true} // A stale/forged role must not grant authority.
			if _, err := store.Select(ctx, actor, "library", "existing", "release"); !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
				t.Fatalf("restricted selection: %v; downloader adds=%d", err, adds.Load())
			}
			if adds.Load() != 0 {
				t.Fatal("restricted reader reached downloader")
			}
		})
	}
	if _, err := db.Exec("UPDATE library_members SET can_request_acquisitions=1,can_advanced_acquisition_request=1,can_bypass_acquisition_approval=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Select(ctx, auth.User{ID: "reader"}, "library", "existing", "release"); err != nil {
		t.Fatal(err)
	}
	if adds.Load() != 1 {
		t.Fatalf("authorized submissions=%d", adds.Load())
	}
}
