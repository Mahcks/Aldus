package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/database"
)

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
	if err := os.WriteFile(filepath.Join(dataDir, "media", "book.bin"), []byte("immutable media"), 0o640); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := Create(ctx, dataDir, archive, "test"); err != nil {
		t.Fatal(err)
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
	restoredDB, err := database.Open(ctx, filepath.Join(restored, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restoredDB.Close()
	var users int
	if err := restoredDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("restored users = %d, %v", users, err)
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
