package acquisition

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestLocalDiscoverySuggestsAvailableAuthorBooksWithoutLeakingLibraries(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.ExecContext(ctx, `
 INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
 VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01','2026-01-01');
 INSERT INTO libraries(id,name,created_at,updated_at)
 VALUES('visible','Visible','2026-01-01','2026-01-01'),('hidden','Hidden','2026-01-01','2026-01-01');
 INSERT INTO library_members(library_id,user_id,role,created_at)
 VALUES('visible','reader','owner','2026-01-01');
 INSERT INTO works(id,library_id,title,author,created_at,updated_at)
 VALUES('seed','visible','Current book','Author','2026-01-01','2026-01-01'),
 ('next','visible','Another book','Author','2026-01-01','2026-01-01'),
 ('unavailable','visible','No file','Author','2026-01-01','2026-01-01'),
 ('secret','hidden','Hidden book','Author','2026-01-01','2026-01-01');
 INSERT INTO representations(id,work_id,kind,label,created_at,updated_at)
 VALUES('seed-edition','seed','epub','Book','2026-01-01','2026-01-01'),
 ('next-edition','next','epub','Book','2026-01-01','2026-01-01'),
 ('secret-edition','secret','epub','Book','2026-01-01','2026-01-01');
 INSERT INTO media(id,representation_id,kind,path,sha256,created_at)
 VALUES('seed-file','seed-edition','epub','seed.epub',lower(hex(randomblob(32))),'2026-01-01'),
 ('next-file','next-edition','epub','next.epub',lower(hex(randomblob(32))),'2026-01-01'),
 ('secret-file','secret-edition','epub','secret.epub',lower(hex(randomblob(32))),'2026-01-01');
 INSERT INTO representation_state(user_id,representation_id,epub_locator,revision,updated_at)
 VALUES('reader','seed-edition','{"href":"chapter.xhtml"}',1,'2026-01-02');`)
	if err != nil {
		t.Fatal(err)
	}
	sections, err := NewStore(db, nil).localDiscoverySections(ctx, auth.User{ID: "reader"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(sections) != 1 || sections[0].Source != "local_author" || len(sections[0].Items) != 1 || sections[0].Items[0].WorkID != "next" {
		t.Fatalf("unexpected suggestions: %#v", sections)
	}
}
