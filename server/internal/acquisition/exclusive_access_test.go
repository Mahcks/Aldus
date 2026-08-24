package acquisition

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestExclusiveMembershipRestrictsAcquisitionDestinations(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01','2026-01-01');
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('family','Family','2026-01-01','2026-01-01'),('kids','Kids','2026-01-01','2026-01-01');
		INSERT INTO library_members(library_id,user_id,role,exclusive,can_request_acquisitions,created_at) VALUES('family','reader','reader',0,1,'2026-01-01'),('kids','reader','reader',1,1,'2026-01-01');
		INSERT INTO library_sources(id,library_id,kind,name,root_path,enabled,created_at,updated_at) VALUES('family-source','family','local','Family downloads','/family',1,'2026-01-01','2026-01-01'),('kids-source','kids','local','Kids downloads','/kids',1,'2026-01-01','2026-01-01');`); err != nil {
		t.Fatal(err)
	}
	store := NewStore(db, nil)
	reader := auth.User{ID: "reader"}
	destinations, err := store.Destinations(ctx, reader)
	if err != nil || len(destinations) != 1 || destinations[0].LibraryID != "kids" {
		t.Fatalf("destinations = %#v, %v", destinations, err)
	}
	if _, err := store.Create(ctx, reader, "family", "family-source", "Alice"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("additive acquisition = %v", err)
	}
	if _, err := store.Create(ctx, reader, "kids", "kids-source", "Alice"); err != nil {
		t.Fatalf("exclusive acquisition = %v", err)
	}
}
