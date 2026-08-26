package acquisition

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestDeletedRequesterDoesNotBreakListingsOrReconciliation(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	const stamp = "2026-01-01T00:00:00Z"
	if _, err := db.Exec(`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES
			('admin','admin','admin','Admin','x',1,0,?,?),
			('reader','reader','reader','Reader','x',0,0,?,?);
		INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?);
		INSERT INTO library_members(library_id,user_id,role,created_at) VALUES('library','admin','owner',?);
		INSERT INTO works(id,library_id,title,created_at,updated_at) VALUES('work','library','Book',?,?);
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,fulfillment_state,work_id,created_at,updated_at) VALUES('request','library','reader','Book','queued','available','work',?,?);
		INSERT INTO title_requests(id,library_id,requested_by,title,created_at,updated_at) VALUES('title','library','reader','Book',?,?);
		INSERT INTO title_request_formats(title_request_id,format,state,created_at,updated_at) VALUES('title','ebook','wanted',?,?);
		DELETE FROM users WHERE id='reader'`, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	actor := auth.User{ID: "admin", Admin: true}
	requests, err := NewStore(db, nil).List(ctx, actor, "library")
	if err != nil || len(requests) != 1 || requests[0].RequestedBy != "" {
		t.Fatalf("anonymous acquisition requests=%#v err=%v", requests, err)
	}
	store := NewStore(db, nil)
	if err := store.reconcileFulfillment(ctx); err != nil {
		t.Fatalf("reconcile anonymous acquisition: %v", err)
	}
	var statuses int
	if err := db.QueryRow(`SELECT COUNT(*) FROM user_work_statuses`).Scan(&statuses); err != nil || statuses != 0 {
		t.Fatalf("anonymous work statuses=%d err=%v", statuses, err)
	}
	titles := NewTitleRequestStore(db)
	listed, err := titles.List(ctx, actor, "library")
	if err != nil || len(listed) != 1 || listed[0].RequestedBy != "" {
		t.Fatalf("anonymous title requests=%#v err=%v", listed, err)
	}
	claimed, ok, err := titles.claimDueFormat(ctx)
	if err != nil || !ok || claimed.requestedBy != "" {
		t.Fatalf("claim anonymous title request=%#v ok=%v err=%v", claimed, ok, err)
	}
}
