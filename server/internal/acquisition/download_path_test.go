package acquisition

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/database"
)

func TestDownloadPathMappingUsesSourceForReferencedAndIngressForManaged(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	sourceRoot := t.TempDir()
	ingress := t.TempDir()
	if err := os.Mkdir(filepath.Join(ingress, "Book"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library','2026-01-01','2026-01-01');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at,storage_kind) VALUES
			('referenced','library','local','Referenced',?,1,'2026-01-01','2026-01-01','referenced'),
			('managed','library','local','Managed',?,1,'2026-01-01','2026-01-01','managed')`, sourceRoot, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, nil)
	store.SetDownloadIngress(ingress)
	referenced, err := store.mapDownloadPath(ctx, "referenced", "/remote/downloads/Book", "/remote/downloads")
	if err != nil || referenced != filepath.Join(sourceRoot, "Book") {
		t.Fatalf("referenced=%q err=%v", referenced, err)
	}
	managed, err := store.mapDownloadPath(ctx, "managed", "/remote/downloads/Book", "/remote/downloads")
	if err != nil || managed != filepath.Join(ingress, "Book") {
		t.Fatalf("managed=%q err=%v", managed, err)
	}
	if _, err := store.mapDownloadPath(ctx, "managed", "/remote/downloads/Missing", "/remote/downloads"); err == nil {
		t.Fatal("missing ingress payload accepted")
	}
}

func TestDownloadIngressDiagnosesMismatchedMount(t *testing.T) {
	ingress := t.TempDir()
	store := &Store{downloadIngress: ingress}
	downloads := []Download{{ContentPath: "/remote/downloads/Book"}}
	if err := store.validateDownloadIngress(downloads, "/remote/downloads"); err == nil {
		t.Fatal("mismatched ingress accepted")
	}
	if err := os.Mkdir(filepath.Join(ingress, "Book"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := store.validateDownloadIngress(downloads, "/remote/downloads"); err != nil {
		t.Fatalf("matching ingress: %v", err)
	}
}
