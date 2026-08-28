package backup

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestManagerOwnsSafeAdminArchives(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, filepath.Join(dataDir, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	manager := NewManager(dataDir, backupDir, "test")
	if _, err := manager.Create(ctx, auth.User{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-admin create error = %v", err)
	}
	admin := auth.User{Admin: true}
	created, err := manager.Create(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	archives, err := manager.List(admin)
	if err != nil || len(archives) != 1 || archives[0].Name != created.Name || archives[0].SizeBytes == 0 {
		t.Fatalf("archives = %#v, %v", archives, err)
	}
	file, _, err := manager.Open(admin, created.Name)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if _, _, err := manager.Open(admin, "../aldus.db"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unsafe name error = %v", err)
	}
	if err := manager.Delete(admin, created.Name); err != nil {
		t.Fatal(err)
	}
	archives, err = manager.List(admin)
	if err != nil || len(archives) != 0 {
		t.Fatalf("archives after delete = %#v, %v", archives, err)
	}
}

func TestCreateVerifyAndRestore(t *testing.T) {
	ctx := context.Background()
	dataDir := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(filepath.Join(dataDir, "media"), 0o750); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, filepath.Join(dataDir, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','hash',1,0,'2026-01-01','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,'admin','2099-01-01','2026-01-01','2026-01-01')`, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	const indexerSecret, qbitSecret = "prowlarr-secret-that-must-not-leak", "qbittorrent-secret-that-must-not-leak"
	const urlSecret = "url-secret-that-must-not-leak"
	const downloadSecret = "download-secret-that-must-not-leak"
	if _, err := db.Exec(`INSERT INTO acquisition_settings(id,indexer_url,indexer_api_key,qbittorrent_url,qbittorrent_username,qbittorrent_password,qbittorrent_category,updated_at) VALUES(1,?,?,'http://qbittorrent','aldus',?,'aldus','2026-01-01')`, "http://user:"+urlSecret+"@prowlarr", indexerSecret, qbitSecret); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "media", "book.bin"), []byte("immutable media"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "models"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "models", "downloaded-model.bin"), []byte("reproducible cache"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "acquisitions", "library", "request"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "acquisitions", "library", "request", "file-000001.epub"), []byte("managed acquisition"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01'); INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at,storage_kind) VALUES('external','library','local','External','/external',1,'2026-01-01','2026-01-01','referenced'); INSERT INTO source_entries(id,source_id,relative_path,size_bytes,modified_at,state,created_at,updated_at) VALUES('entry','external','book.epub',1,'2026-01-01','registered','2026-01-01','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,selected_url,fulfillment_state,created_at,updated_at) VALUES('request','library','admin','Book','requested',?,'submitting','2026-01-01','2026-01-01');
		INSERT INTO acquisition_results(id,request_id,title,download_url,source,size,created_at) VALUES('result','request','Book',?,'Indexer',1,'2026-01-01');
		INSERT INTO title_requests(id,library_id,requested_by,title,created_at,updated_at) VALUES('title','library','admin','Book','2026-01-01','2026-01-01');
		INSERT INTO title_request_formats(title_request_id,format,state,legacy_acquisition_request_id,created_at,updated_at) VALUES('title','ebook','submitting','request','2026-01-01','2026-01-01')`, "https://indexer.test/download?apikey="+downloadSecret, "https://indexer.test/file?apikey="+downloadSecret); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := Create(ctx, dataDir, archive, "test"); err != nil {
		t.Fatal(err)
	}
	var liveIndexerSecret, liveQBitSecret string
	if err := db.QueryRow(`SELECT indexer_api_key,qbittorrent_password FROM acquisition_settings WHERE id=1`).Scan(&liveIndexerSecret, &liveQBitSecret); err != nil || liveIndexerSecret != indexerSecret || liveQBitSecret != qbitSecret {
		t.Fatalf("live connector secrets changed = %q %q, %v", liveIndexerSecret, liveQBitSecret, err)
	}
	var liveDownloadURL string
	if err := db.QueryRow(`SELECT download_url FROM acquisition_results WHERE id='result'`).Scan(&liveDownloadURL); err != nil || !strings.Contains(liveDownloadURL, downloadSecret) {
		t.Fatalf("live download URL changed = %q, %v", liveDownloadURL, err)
	}
	var liveSessions int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&liveSessions); err != nil || liveSessions != 1 {
		t.Fatalf("live sessions = %d, %v", liveSessions, err)
	}
	extracted := t.TempDir()
	manifest, err := extractAndVerify(archive, extracted)
	if err != nil || !manifest.ConnectorSecretsRedacted {
		t.Fatalf("backup manifest redaction=%v, %v", manifest.ConnectorSecretsRedacted, err)
	}
	if manifest.ManagedAcquisitionFiles != 1 || manifest.ExternalMediaExcluded != 1 {
		t.Fatalf("media completeness counts managed=%d external=%d", manifest.ManagedAcquisitionFiles, manifest.ExternalMediaExcluded)
	}
	if _, ok := manifest.Files["models/downloaded-model.bin"]; ok {
		t.Fatal("backup includes reproducible alignment model cache")
	}
	snapshotBytes, err := os.ReadFile(filepath.Join(extracted, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(snapshotBytes), indexerSecret) || strings.Contains(string(snapshotBytes), qbitSecret) || strings.Contains(string(snapshotBytes), downloadSecret) || strings.Contains(string(snapshotBytes), urlSecret) {
		t.Fatal("backup database retains connector secret bytes")
	}
	db.Close()
	restored := filepath.Join(t.TempDir(), "restored")
	if err := Restore(ctx, archive, restored); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(restored, "media", "book.bin"))
	if err != nil || string(data) != "immutable media" {
		t.Fatalf("restored media = %q, %v", data, err)
	}
	managed, err := os.ReadFile(filepath.Join(restored, "acquisitions", "library", "request", "file-000001.epub"))
	if err != nil || string(managed) != "managed acquisition" {
		t.Fatalf("restored managed media=%q err=%v", managed, err)
	}
	restoredDB, err := database.Open(ctx, filepath.Join(restored, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restoredDB.Close()
	var users int
	if err := restoredDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("restored users = %d, %v", users, err)
	}
	var sessions int
	if err := restoredDB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&sessions); err != nil || sessions != 0 {
		t.Fatalf("restored sessions = %d, %v", sessions, err)
	}
	var restoredIndexerSecret, restoredQBitSecret string
	if err := restoredDB.QueryRow(`SELECT indexer_api_key,qbittorrent_password FROM acquisition_settings WHERE id=1`).Scan(&restoredIndexerSecret, &restoredQBitSecret); err != nil || restoredIndexerSecret != "" || restoredQBitSecret != "" {
		t.Fatalf("restored connector secrets = %q %q, %v", restoredIndexerSecret, restoredQBitSecret, err)
	}
	var restoredSelectedURL, restoredDownloadURL string
	if err := restoredDB.QueryRow(`SELECT COALESCE(selected_url,'') FROM acquisition_requests WHERE id='request'`).Scan(&restoredSelectedURL); err != nil {
		t.Fatal(err)
	}
	if err := restoredDB.QueryRow(`SELECT download_url FROM acquisition_results WHERE id='result'`).Scan(&restoredDownloadURL); err != nil || restoredSelectedURL != "" || restoredDownloadURL != "" {
		t.Fatalf("restored download URLs = %q %q, %v", restoredSelectedURL, restoredDownloadURL, err)
	}
	var requestState, formatState string
	if err := restoredDB.QueryRow(`SELECT fulfillment_state FROM acquisition_requests WHERE id='request'`).Scan(&requestState); err != nil {
		t.Fatal(err)
	}
	if err := restoredDB.QueryRow(`SELECT state FROM title_request_formats WHERE title_request_id='title' AND format='ebook'`).Scan(&formatState); err != nil || requestState != "awaiting_selection" || formatState != "awaiting_release" {
		t.Fatalf("restored active submission states = %q %q, %v", requestState, formatState, err)
	}
}

func TestRestoreRefusesNonemptyDestination(t *testing.T) {
	destination := t.TempDir()
	if err := os.WriteFile(filepath.Join(destination, "keep"), []byte("mine"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Restore(context.Background(), "missing", destination); err == nil {
		t.Fatal("restore accepted a nonempty destination")
	}
}
