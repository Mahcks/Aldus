package acquisition

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/database"
)

func TestDownloadMonitoringClassifiesOnlyDurableFailures(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var monitoringColumns int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('acquisition_requests') WHERE name='torrent_hash'`).Scan(&monitoringColumns); err != nil {
		t.Fatal(err)
	}
	if monitoringColumns == 0 {
		schema, err := os.ReadFile("../database/migrations/031_acquisition_download_monitoring.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(schema)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('user','user','user','User','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"complete", "error", "missing", "never", "stalled", "paused", "resumed"} {
		if _, err := db.Exec(`INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,download_state,fulfillment_state,created_at,updated_at) VALUES(?,'library','user','Book','queued','downloading','downloading','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, id); err != nil {
			t.Fatal(err)
		}
	}
	store := NewStore(db, nil)
	now := time.Date(2026, 8, 18, 20, 0, 0, 0, time.UTC)
	old := now.Add(-25 * time.Hour).Format(time.RFC3339Nano)
	recent := now.Add(-5 * time.Minute).Format(time.RFC3339Nano)

	failed, err := store.monitorDownload(ctx, downloadMonitorRequest{id: "complete", progressUpdated: recent}, &Download{Hash: "hash", State: "uploading", Progress: 1}, now)
	if err != nil || failed {
		t.Fatalf("completed monitor failed=%v err=%v", failed, err)
	}
	var hash, seen string
	var progress float64
	if err := db.QueryRow(`SELECT torrent_hash,download_last_seen_at,download_progress FROM acquisition_requests WHERE id='complete'`).Scan(&hash, &seen, &progress); err != nil || hash != "hash" || seen == "" || progress != 1 {
		t.Fatalf("completed monitoring = %q %q %v, %v", hash, seen, progress, err)
	}

	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "error", progressUpdated: recent}, &Download{Hash: "bad", State: "missingFiles", Progress: .4}, now)
	if err != nil || !failed {
		t.Fatalf("error monitor failed=%v err=%v", failed, err)
	}
	assertDownloadDiagnosis(t, db, "error", "cannot find")

	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "missing", lastSeen: old, progressUpdated: old}, nil, now)
	if err != nil || !failed {
		t.Fatalf("missing monitor failed=%v err=%v", failed, err)
	}
	assertDownloadDiagnosis(t, db, "missing", "no longer has")

	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "never", progressUpdated: recent}, nil, now)
	if err != nil || failed {
		t.Fatalf("never-seen grace failed=%v err=%v", failed, err)
	}
	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "never", progressUpdated: old}, nil, now)
	if err != nil || !failed {
		t.Fatalf("never-seen expiry failed=%v err=%v", failed, err)
	}
	assertDownloadDiagnosis(t, db, "never", "never reported")

	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "stalled", progress: .3, progressUpdated: old}, &Download{Hash: "stall", State: "stalledDL", Progress: .3}, now)
	if err != nil || !failed {
		t.Fatalf("stalled monitor failed=%v err=%v", failed, err)
	}
	assertDownloadDiagnosis(t, db, "stalled", "no progress for 24 hours")

	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "paused", progress: .3, progressUpdated: old}, &Download{Hash: "pause", State: "pausedDL", Progress: .3}, now)
	if err != nil || failed {
		t.Fatalf("paused monitor failed=%v err=%v", failed, err)
	}
	failed, err = store.monitorDownload(ctx, downloadMonitorRequest{id: "resumed", progress: .3, progressUpdated: old}, &Download{Hash: "resume", State: "downloading", Progress: .4}, now)
	if err != nil || failed {
		t.Fatalf("resumed monitor failed=%v err=%v", failed, err)
	}
	if err := db.QueryRow(`SELECT download_progress,download_progress_updated_at FROM acquisition_requests WHERE id='resumed'`).Scan(&progress, &seen); err != nil || progress != .4 || seen != now.Format(time.RFC3339Nano) {
		t.Fatalf("resumed progress = %v %q, %v", progress, seen, err)
	}
}

func assertDownloadDiagnosis(t *testing.T, db *sql.DB, id, contains string) {
	t.Helper()
	var state, diagnosis string
	if err := db.QueryRow(`SELECT fulfillment_state,download_error FROM acquisition_requests WHERE id=?`, id).Scan(&state, &diagnosis); err != nil || state != "failed" || !strings.Contains(diagnosis, contains) {
		t.Fatalf("download %s state=%q diagnosis=%q err=%v", id, state, diagnosis, err)
	}
}
