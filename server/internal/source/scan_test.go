package source

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/database"
)

func TestAliceScanIsIdempotentAndReconcilesChanges(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?)`, now, now, now, now)
	if err != nil {
		t.Fatal(err)
	}
	allowed := t.TempDir()
	root := filepath.Join(allowed, "books")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub"), filepath.Join(root, "alice.epub"))
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice-chapter-01.mp3"), filepath.Join(root, "alice.mp3"))
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice-chapter-01.mp3"), filepath.Join(root, "alice-copy.mp3"))
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(allowed, "outside.mp3"), filepath.Join(root, "linked.mp3")); err != nil {
		t.Fatal(err)
	}
	store, err := New(db, Options{AllowedRoots: []string{allowed}, ManagedRoot: t.TempDir(), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.Create(ctx, auth.User{ID: "admin", Admin: true}, "library", "Alice", root, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueScan(ctx, auth.User{ID: "admin", Admin: true}, "library", saved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueScan(ctx, auth.User{ID: "admin", Admin: true}, "library", saved.ID); err != ErrActiveScan {
		t.Fatalf("simultaneous scan = %v", err)
	}
	if _, err := db.Exec(`DELETE FROM source_scans WHERE source_id=?`, saved.ID); err != nil {
		t.Fatal(err)
	}
	first := runTestScan(t, store, saved.ID, "scan-1")
	if first.FilesVisited != 4 || first.Supported != 3 || first.EPUB != 1 || first.Audio != 2 || first.New != 3 || first.Problems != 0 {
		t.Fatalf("first scan=%+v", first)
	}
	entries, err := store.Entries(ctx, auth.User{ID: "admin", Admin: true}, "library", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("entries=%d", len(entries))
	}
	hashes := map[string]string{}
	for _, entry := range entries {
		hashes[entry.RelativePath] = entry.SHA256
		if entry.Kind == "epub" && !strings.Contains(string(entry.Metadata), "Alice's Adventures in Wonderland") {
			t.Fatalf("EPUB metadata=%s", entry.Metadata)
		}
		if entry.Kind == "epub" && !strings.Contains(string(entry.Metadata), `"has_cover":true`) {
			t.Fatalf("EPUB cover metadata=%s", entry.Metadata)
		}
		if entry.Kind == "audio" && !strings.Contains(string(entry.Metadata), "864253") {
			t.Fatalf("audio metadata=%s", entry.Metadata)
		}
	}
	if hashes["alice.epub"] != "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c" || hashes["alice.mp3"] != "6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a" {
		t.Fatalf("hashes=%v", hashes)
	}
	proposals, err := store.Proposals(ctx, auth.User{ID: "admin", Admin: true}, "library")
	if err != nil {
		t.Fatal(err)
	}
	if len(proposals) != 1 || proposals[0].Title != "Alice's Adventures in Wonderland" || proposals[0].Author != "Lewis Carroll" || proposals[0].Confidence != "high" || len(proposals[0].Items) != 3 {
		t.Fatalf("Alice proposal=%+v", proposals)
	}
	firstProposalID, firstRevision := proposals[0].ID, proposals[0].Revision
	second := runTestScan(t, store, saved.ID, "scan-2")
	if second.Unchanged != 3 || second.New != 0 || second.Changed != 0 {
		t.Fatalf("second scan=%+v", second)
	}
	proposals, _ = store.Proposals(ctx, auth.User{ID: "admin", Admin: true}, "library")
	if proposals[0].ID != firstProposalID || proposals[0].Revision != firstRevision {
		t.Fatalf("proposal changed on rescan=%+v", proposals[0])
	}
	items := make([]AcceptItem, len(proposals[0].Items))
	for i, item := range proposals[0].Items {
		items[i] = AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label}
	}
	workID, err := store.AcceptProposal(ctx, auth.User{ID: "admin", Admin: true}, "library", proposals[0].ID, AcceptRequest{ExpectedRevision: proposals[0].Revision, Title: proposals[0].Title, Author: proposals[0].Author, Items: items})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcceptProposal(ctx, auth.User{ID: "admin", Admin: true}, "library", proposals[0].ID, AcceptRequest{ExpectedRevision: proposals[0].Revision, Title: proposals[0].Title, Items: items}); err != ErrConflict {
		t.Fatalf("stale accept=%v", err)
	}
	var works, reps, media int
	db.QueryRow(`SELECT COUNT(*) FROM works WHERE id=?`, workID).Scan(&works)
	db.QueryRow(`SELECT COUNT(*) FROM representations WHERE work_id=?`, workID).Scan(&reps)
	db.QueryRow(`SELECT COUNT(*) FROM media m JOIN representations r ON r.id=m.representation_id WHERE r.work_id=? AND m.storage_kind='referenced'`, workID).Scan(&media)
	if works != 1 || reps != 2 || media != 2 {
		t.Fatalf("accepted counts=%d %d %d", works, reps, media)
	}
	var coverURL string
	if err := db.QueryRow(`SELECT c.image_url FROM works w JOIN work_covers c ON c.id=w.selected_cover_id WHERE w.id=?`, workID).Scan(&coverURL); err != nil || !strings.HasSuffix(coverURL, "/cover") {
		t.Fatalf("selected embedded cover=%q, %v", coverURL, err)
	}
	var locations int
	db.QueryRow(`SELECT COUNT(*) FROM media_locations ml JOIN media m ON m.id=ml.media_id JOIN representations r ON r.id=m.representation_id WHERE r.work_id=?`, workID).Scan(&locations)
	if locations != 3 {
		t.Fatalf("media locations=%d", locations)
	}
	if active, _ := store.Proposals(ctx, auth.User{ID: "admin", Admin: true}, "library"); len(active) != 0 {
		t.Fatalf("accepted proposal active=%+v", active)
	}
	f, err := os.OpenFile(filepath.Join(root, "alice.mp3"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write([]byte{0}); err != nil {
		t.Fatal(err)
	}
	f.Close()
	changed := runTestScan(t, store, saved.ID, "scan-3")
	if changed.Changed != 1 || changed.Unchanged != 2 {
		t.Fatalf("changed scan=%+v", changed)
	}
	changedProposals, err := store.Proposals(ctx, auth.User{ID: "admin", Admin: true}, "library")
	if err != nil || len(changedProposals) != 1 {
		t.Fatalf("changed proposals=%+v, %v", changedProposals, err)
	}
	changedItems := make([]AcceptItem, len(changedProposals[0].Items))
	for i, item := range changedProposals[0].Items {
		changedItems[i] = AcceptItem{SourceEntryID: item.EntryID, Kind: item.Kind, Label: item.Label}
	}
	if attached, err := store.AcceptProposal(ctx, auth.User{ID: "admin", Admin: true}, "library", changedProposals[0].ID, AcceptRequest{ExpectedRevision: changedProposals[0].Revision, WorkID: workID, Items: changedItems}); err != nil || attached != workID {
		t.Fatalf("existing work acceptance=%q, %v", attached, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM works WHERE library_id='library'`).Scan(&works); err != nil || works != 1 {
		t.Fatalf("duplicate works=%d, %v", works, err)
	}
	if err := os.Remove(filepath.Join(root, "alice.mp3")); err != nil {
		t.Fatal(err)
	}
	missing := runTestScan(t, store, saved.ID, "scan-4")
	if missing.Missing != 1 || missing.Supported != 2 {
		t.Fatalf("missing scan=%+v", missing)
	}
	var audioMediaID string
	if err := db.QueryRow(`SELECT m.id FROM media m JOIN representations r ON r.id=m.representation_id WHERE r.work_id=? AND m.kind='audio'`, workID).Scan(&audioMediaID); err != nil {
		t.Fatal(err)
	}
	file, err := store.OpenMedia(ctx, audioMediaID, true)
	if err != nil {
		t.Fatalf("duplicate location fallback=%v", err)
	}
	file.Close()
	if _, err := db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,started_at) VALUES('interrupted',?,'scanning',?,?)`, saved.ID, now, now); err != nil {
		t.Fatal(err)
	}
	if err := store.recoverScans(ctx); err != nil {
		t.Fatal(err)
	}
	var recovered string
	if err := db.QueryRow(`SELECT state FROM source_scans WHERE id='interrupted'`).Scan(&recovered); err != nil || recovered != "pending" {
		t.Fatalf("recovered=%q, %v", recovered, err)
	}
}

func TestSourceAutomaticallyImportsClearMatch(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,is_admin,disabled,created_at,updated_at) VALUES('admin','admin','admin','Admin','x',1,0,?,?); INSERT INTO libraries(id,name,created_at,updated_at) VALUES('library','Library',?,?)`, now, now, now, now); err != nil {
		t.Fatal(err)
	}
	allowed := t.TempDir()
	root := filepath.Join(allowed, "books")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	copyFile(t, filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub"), filepath.Join(root, "alice.epub"))
	store, err := New(db, Options{AllowedRoots: []string{allowed}, ManagedRoot: t.TempDir(), MaxBytes: 16 << 20})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.Create(ctx, auth.User{ID: "admin", Admin: true}, "library", "Alice", root, true)
	if err != nil {
		t.Fatal(err)
	}
	scan := runTestScan(t, store, saved.ID, "auto-scan")
	if scan.AutoImported != 1 {
		t.Fatalf("auto imported=%d", scan.AutoImported)
	}
	if proposals, err := store.Proposals(ctx, auth.User{ID: "admin", Admin: true}, "library"); err != nil || len(proposals) != 0 {
		t.Fatalf("remaining proposals=%+v, %v", proposals, err)
	}
	var works, selectedCovers int
	if err := db.QueryRow(`SELECT COUNT(*) FROM works WHERE library_id='library'`).Scan(&works); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM works WHERE library_id='library' AND selected_cover_id IS NOT NULL`).Scan(&selectedCovers); err != nil {
		t.Fatal(err)
	}
	if works != 1 || selectedCovers != 1 {
		t.Fatalf("works=%d selected covers=%d", works, selectedCovers)
	}
}

func TestInspectionAndHashingRejectInvalidOversizedAndCanceledInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.epub")
	if err := os.WriteFile(path, []byte("not an epub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectEPUB(path, 1024); err == nil {
		t.Fatal("corrupt EPUB accepted")
	}
	if _, err := hashPath(context.Background(), path, 2); err == nil {
		t.Fatal("oversized file accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := hashPath(ctx, path, 1024); err != context.Canceled {
		t.Fatalf("canceled hash=%v", err)
	}
}

func runTestScan(t *testing.T, store *Store, sourceID, id string) Scan {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := store.db.Exec(`INSERT INTO source_scans(id,source_id,state,created_at,started_at) VALUES(?,?,'scanning',?,?)`, id, sourceID, now, now); err != nil {
		t.Fatal(err)
	}
	if err := store.runScan(ctx, Scan{ID: id, SourceID: sourceID}); err != nil {
		t.Fatal(err)
	}
	scans, err := store.Scans(ctx, auth.User{ID: "admin", Admin: true}, "library", sourceID)
	if err != nil {
		t.Fatal(err)
	}
	return scans[0]
}
func copyFile(t *testing.T, from, to string) {
	t.Helper()
	source, err := os.Open(from)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	target, err := os.Create(to)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		t.Fatal(err)
	}
	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
}
