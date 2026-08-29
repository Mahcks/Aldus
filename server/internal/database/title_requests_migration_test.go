package database

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestTitleRequestMigrationBackfillsOnlyKnownFormats(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", t.TempDir()+"/aldus.db")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys=ON;`+strings.Join(migrations[:26], "\n")+`
		INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at)
		VALUES('reader','reader','reader','Reader','x',0,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO libraries(id,name,created_at,updated_at)
		VALUES('library','Library','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
		INSERT INTO acquisition_pairs(id,library_id,requested_by,query,created_at,updated_at)
		VALUES('pair','library','reader','Alice','2026-01-01T00:00:00Z','2026-01-01T00:03:00Z');
		INSERT INTO acquisition_requests(id,library_id,requested_by,query,status,pair_id,selected_title,fulfillment_state,advisory_title,advisory_author,advisory_isbn,advisory_source,created_at,updated_at)
		VALUES
			('ebook','library','reader','Alice','queued','pair','Alice.epub','available','Alice','Lewis Carroll','isbn','open_library','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z'),
			('audio','library','reader','Alice','queued','pair','Alice.m4b','downloading','Alice','Lewis Carroll','isbn','open_library','2026-01-01T00:00:00Z','2026-01-01T00:02:00Z'),
			('unknown','library','reader','Earthsea','requested',NULL,'A Wizard of Earthsea','awaiting_selection','','','','','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, migrations[27]); err != nil {
		t.Fatal(err)
	}

	var title, author, source, externalID string
	if err := db.QueryRowContext(ctx, `SELECT title,author,external_source,external_id FROM title_requests WHERE id='legacy-pair:pair'`).Scan(&title, &author, &source, &externalID); err != nil || title != "Alice" || author != "Lewis Carroll" || source != "open_library" || externalID != "isbn" {
		t.Fatalf("paired title request = %q %q %q %q, %v", title, author, source, externalID, err)
	}
	rows, err := db.QueryContext(ctx, `SELECT format,state,legacy_acquisition_request_id FROM title_request_formats ORDER BY format`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := [][3]string{{"audiobook", "downloading", "audio"}, {"ebook", "available", "ebook"}}
	for index, expected := range want {
		if !rows.Next() {
			t.Fatalf("format row %d missing", index)
		}
		var format, state, legacyID string
		if err := rows.Scan(&format, &state, &legacyID); err != nil {
			t.Fatal(err)
		}
		if got := [3]string{format, state, legacyID}; got != expected {
			t.Fatalf("format row %d = %#v, want %#v", index, got, expected)
		}
	}
	if rows.Next() {
		t.Fatal("ambiguous legacy release was classified")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	var parents, events int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM title_requests`).Scan(&parents); err != nil || parents != 2 {
		t.Fatalf("title requests=%d, %v", parents, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM title_request_events WHERE event_type='legacy_migrated'`).Scan(&events); err != nil || events != 2 {
		t.Fatalf("migration events=%d, %v", events, err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO title_request_formats(title_request_id,format,state,created_at,updated_at) VALUES('legacy-request:unknown','ebook','invalid','now','now')`); err == nil {
		t.Fatal("invalid lifecycle state accepted")
	}
	var violation string
	if err := db.QueryRowContext(ctx, `PRAGMA foreign_key_check`).Scan(&violation); err != sql.ErrNoRows {
		t.Fatalf("foreign key check=%q, %v", violation, err)
	}
}
