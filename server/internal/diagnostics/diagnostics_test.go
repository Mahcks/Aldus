package diagnostics

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestReportIsAdminOnlyAndChecksRuntimeState(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	db, err := database.Open(ctx, filepath.Join(dataDir, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	reachable := t.TempDir()
	store := New(db, dataDir, []string{reachable, filepath.Join(dataDir, "missing")}, "v1.2.3", "test")
	if _, err := store.Report(ctx, auth.User{}); err != ErrForbidden {
		t.Fatalf("reader report error = %v", err)
	}
	report, err := store.Report(ctx, auth.User{Admin: true})
	if err != nil {
		t.Fatal(err)
	}
	if report.Version != "v1.2.3" || report.Environment != "test" || report.DatabaseStatus != "ok" || report.StorageStatus != "ok" || report.SchemaVersion != 40 || report.SourceRootsConfigured != 2 || report.SourceRootsReachable != 1 {
		t.Fatalf("report = %#v", report)
	}
}
