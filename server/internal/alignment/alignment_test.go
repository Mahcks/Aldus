package alignment

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

type testState struct {
	manager                 *Manager
	accounts                *auth.Store
	admin, reader, outsider auth.User
	request                 Request
	dbPath, root, script    string
}

func TestCancellationAuthorizationReturnsDatabaseErrors(t *testing.T) {
	state := setupManager(t, "success", time.Second)
	if err := state.manager.db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := state.manager.canCancel(context.Background(), state.reader.ID, "missing"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("authorization error = %v", err)
	}
}

func setupManager(t *testing.T, mode string, timeout time.Duration) *testState {
	t.Helper()
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "aldus.db")
	db, err := database.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	accounts, err := auth.New(db, auth.Options{})
	if err != nil {
		t.Fatal(err)
	}
	session, err := accounts.Setup(ctx, auth.Credentials{Username: "admin", Password: "a-secure-admin-password"})
	if err != nil {
		t.Fatal(err)
	}
	newUser := func(name string) auth.User {
		u, e := accounts.CreateUser(ctx, session.User, auth.Credentials{Username: name, Password: "a-secure-user-password"}, false)
		if e != nil {
			t.Fatal(e)
		}
		return u
	}
	reader, outsider := newUser("reader"), newUser("outsider")
	cat := catalog.New(db)
	library, err := cat.CreateLibrary(ctx, session.User, "Library")
	if err != nil {
		t.Fatal(err)
	}
	if err := cat.SetMember(ctx, session.User, library.ID, reader.ID, "reader"); err != nil {
		t.Fatal(err)
	}
	work, err := cat.CreateWork(ctx, session.User, library.ID, "Alice", "")
	if err != nil {
		t.Fatal(err)
	}
	epubRep, err := cat.CreateRepresentation(ctx, session.User, work.ID, "epub", "EPUB")
	if err != nil {
		t.Fatal(err)
	}
	audioRep, err := cat.CreateRepresentation(ctx, session.User, work.ID, "audio", "Audio")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	mediaDir := filepath.Join(root, "media")
	os.MkdirAll(filepath.Join(mediaDir, "aa"), 0o750)
	epub := testEPUB(t)
	audio := []byte("ID3audio")
	eh := sha(epub)
	ah := sha(audio)
	epath := filepath.Join("aa", eh+".epub")
	apath := filepath.Join("aa", ah+".audio")
	os.WriteFile(filepath.Join(mediaDir, epath), epub, 0o600)
	os.WriteFile(filepath.Join(mediaDir, apath), audio, 0o600)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO media(id,representation_id,kind,path,sha256,created_at,original_filename,size_bytes) VALUES('epub',?,'epub',?,?,?,'book.epub',?),('audio',?,'audio',?,?,?,'book.mp3',?)`, epubRep.ID, epath, eh, now, len(epub), audioRep.ID, apath, ah, now, len(audio)); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(t.TempDir(), "worker.py")
	if err := os.WriteFile(script, []byte(fakeWorker(mode)), 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(db, Options{MediaRoot: root, ArtifactRoot: filepath.Join(root, "artifacts"), Command: []string{"python3", script}, Timeout: timeout, AudioDuration: func(context.Context, string) (int64, error) { return 1000, nil }})
	if err != nil {
		t.Fatal(err)
	}
	return &testState{manager: manager, accounts: accounts, admin: session.User, reader: reader, outsider: outsider, request: Request{EPUBMediaID: "epub", EPUBSHA256: eh, AudioMediaID: "audio", AudioSHA256: ah}, dbPath: dbPath, root: root, script: script}
}

func TestJobReadyDuplicateAndAuthorization(t *testing.T) {
	s := setupManager(t, "success", time.Second)
	ctx := context.Background()
	if _, err := s.manager.Enqueue(ctx, s.reader, s.request); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reader enqueue=%v", err)
	}
	if _, err := s.manager.Enqueue(ctx, s.outsider, s.request); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider enqueue=%v", err)
	}
	bad := s.request
	bad.AudioSHA256 = strings.Repeat("0", 64)
	if _, err := s.manager.Enqueue(ctx, s.admin, bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong hash=%v", err)
	}
	bad = s.request
	bad.EPUBMediaID = "audio"
	bad.EPUBSHA256 = s.request.AudioSHA256
	if _, err := s.manager.Enqueue(ctx, s.admin, bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong kinds=%v", err)
	}
	var libraryID, originalRepresentation string
	if err := s.manager.db.QueryRow(`SELECT library_id FROM works LIMIT 1`).Scan(&libraryID); err != nil {
		t.Fatal(err)
	}
	otherWork, err := catalog.New(s.manager.db).CreateWork(ctx, s.admin, libraryID, "Other", "")
	if err != nil {
		t.Fatal(err)
	}
	otherRepresentation, err := catalog.New(s.manager.db).CreateRepresentation(ctx, s.admin, otherWork.ID, "audio", "Other audio")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.manager.db.QueryRow(`SELECT representation_id FROM media WHERE id='audio'`).Scan(&originalRepresentation); err != nil {
		t.Fatal(err)
	}
	if _, err := s.manager.db.Exec(`UPDATE media SET representation_id=? WHERE id='audio'`, otherRepresentation.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.manager.Enqueue(ctx, s.admin, s.request); !errors.Is(err, ErrInvalid) {
		t.Fatalf("different works=%v", err)
	}
	if _, err := s.manager.db.Exec(`UPDATE media SET representation_id=? WHERE id='audio'`, originalRepresentation); err != nil {
		t.Fatal(err)
	}
	job, err := s.manager.Enqueue(ctx, s.admin, s.request)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.manager.Enqueue(ctx, s.admin, s.request)
	if err != nil || duplicate.ID != job.ID {
		t.Fatalf("duplicate=%#v, %v", duplicate, err)
	}
	claimed, ok, err := s.manager.claim(ctx)
	if !ok || claimed.ID != job.ID {
		t.Fatal("job not claimed")
	}
	s.manager.run(ctx, claimed)
	ready, err := s.manager.Job(ctx, s.admin, job.ID)
	if err != nil || ready.State != "ready" || ready.AlignmentID == "" || len(ready.ArtifactID) != 64 {
		t.Fatalf("ready=%#v, %v", ready, err)
	}
	var alignments, segments, inputs int
	s.manager.db.QueryRow(`SELECT COUNT(*) FROM alignments WHERE id=? AND state='ready'`, job.ID).Scan(&alignments)
	s.manager.db.QueryRow(`SELECT COUNT(*) FROM alignment_segments WHERE alignment_id=?`, job.ID).Scan(&segments)
	s.manager.db.QueryRow(`SELECT COUNT(*) FROM alignment_inputs WHERE alignment_id=?`, job.ID).Scan(&inputs)
	if alignments != 1 || segments != 1 || inputs != 2 {
		t.Fatalf("published=%d/%d/%d", alignments, segments, inputs)
	}
	var documentID string
	if err := s.manager.db.QueryRow(`SELECT document_id FROM koreader_aliases WHERE media_id='epub'`).Scan(&documentID); err != nil {
		t.Fatal(err)
	}
	locator, err := position.New(s.manager.db).CanonicalToKOReader(ctx, position.Canonical{AlignmentID: job.ID, SegmentID: "s000001", Offset: 500_000})
	if err != nil || locator.DocumentID != documentID || !strings.HasPrefix(locator.Progress, "/body/DocFragment[1]/body[1]/div[1]/p[1]/text()[1].") {
		t.Fatalf("production KOReader locator=%#v, %v", locator, err)
	}
	canonical, err := position.New(s.manager.db).KOReaderToCanonical(ctx, locator)
	if err != nil || canonical.AlignmentID != job.ID || canonical.SegmentID != "s000001" {
		t.Fatalf("KOReader round trip=%#v, %v", canonical, err)
	}
	if _, err := s.manager.db.Exec(`UPDATE alignment_segments SET koreader_locator='unavailable:s000001' WHERE alignment_id=?; DELETE FROM koreader_aliases WHERE media_id='epub'`, job.ID); err != nil {
		t.Fatal(err)
	}
	updated, skipped, err := s.manager.BackfillKOReader(ctx)
	if err != nil || updated != 1 || skipped != 0 {
		t.Fatalf("KOReader backfill=%d/%d, %v", updated, skipped, err)
	}
	if _, err := position.New(s.manager.db).CanonicalToKOReader(ctx, position.Canonical{AlignmentID: job.ID, SegmentID: "s000001", Offset: 500_000}); err != nil {
		t.Fatalf("backfilled locator: %v", err)
	}
}

func TestFailuresTimeoutAndSafeConfidence(t *testing.T) {
	for _, mode := range []string{"failure", "malformed", "wrong_hash"} {
		t.Run(mode, func(t *testing.T) {
			s := setupManager(t, mode, time.Second)
			job, _ := s.manager.Enqueue(context.Background(), s.admin, s.request)
			claimed, _, _ := s.manager.claim(context.Background())
			s.manager.run(context.Background(), claimed)
			failed, _ := s.manager.Job(context.Background(), s.admin, job.ID)
			if failed.State != "failed" {
				t.Fatalf("state=%s", failed.State)
			}
			var n int
			s.manager.db.QueryRow(`SELECT COUNT(*) FROM alignments WHERE id=?`, job.ID).Scan(&n)
			if n != 0 {
				t.Fatal("partial alignment published")
			}
		})
	}
	s := setupManager(t, "sleep", 20*time.Millisecond)
	job, _ := s.manager.Enqueue(context.Background(), s.admin, s.request)
	claimed, _, _ := s.manager.claim(context.Background())
	s.manager.run(context.Background(), claimed)
	failed, _ := s.manager.Job(context.Background(), s.admin, job.ID)
	if failed.State != "failed" || failed.Error != "worker timeout" {
		t.Fatalf("timeout=%#v", failed)
	}
	safe := setupManager(t, "unresolved", time.Second)
	job, _ = safe.manager.Enqueue(context.Background(), safe.admin, safe.request)
	claimed, _, _ = safe.manager.claim(context.Background())
	safe.manager.run(context.Background(), claimed)
	var highlightable int
	safe.manager.db.QueryRow(`SELECT highlightable FROM alignment_segments WHERE alignment_id=?`, job.ID).Scan(&highlightable)
	if highlightable != 0 {
		t.Fatal("unresolved segment is highlightable")
	}
}

func TestValidateRejectsNonMonotonicTimings(t *testing.T) {
	input := workerInput{EPUBSHA256: strings.Repeat("a", 64), AudioSHA256: strings.Repeat("b", 64), AudioResource: "book.mp3", AudioDuration: 1000, Model: "base.en", Segments: []inputSegment{{ID: "one", Ordinal: 0, Text: "One", Href: "chapter.xhtml", DOMPath: "html[1]/body[1]/p[1]"}, {ID: "two", Ordinal: 1, Text: "Two", Href: "chapter.xhtml", DOMPath: "html[1]/body[1]/p[2]"}}}
	artifact := Artifact{Version: ContractVersion, Tool: "whisperx 3.8.6", Model: input.Model, EPUBSHA256: input.EPUBSHA256, AudioSHA256: input.AudioSHA256}
	for i, expected := range input.Segments {
		var segment Segment
		segment.ID, segment.Ordinal, segment.Text, segment.NormalizedText = expected.ID, expected.Ordinal, expected.Text, expected.Text
		segment.EPUB.Href, segment.EPUB.DOMPath = expected.Href, expected.DOMPath
		segment.EPUB.Locator = json.RawMessage(`{"type":"dom-element","dom_path":"` + expected.DOMPath + `"}`)
		segment.Audio.Resource, segment.Audio.StartMS, segment.Audio.EndMS = input.AudioResource, int64(100+i*300), int64(500+i*300)
		segment.Status, segment.Highlightable = "aligned", true
		artifact.Segments = append(artifact.Segments, segment)
	}
	artifact.Segments[1].Audio.StartMS = 400
	if err := validate(artifact, input, artifact.Tool); err == nil {
		t.Fatal("non-monotonic artifact accepted")
	}
}

func TestCancelAndRestartRecovery(t *testing.T) {
	s := setupManager(t, "sleep", time.Second)
	ctx := context.Background()
	pending, _ := s.manager.Enqueue(ctx, s.admin, s.request)
	if err := s.manager.Cancel(ctx, s.admin, pending.ID); err != nil {
		t.Fatal(err)
	}
	canceled, _ := s.manager.Job(ctx, s.admin, pending.ID)
	if canceled.State != "failed" || canceled.Error != "canceled" {
		t.Fatalf("pending cancel=%#v", canceled)
	}
	// A different model permits a second job for the same immutable inputs.
	s.manager.options.Model = "other"
	processing, _ := s.manager.Enqueue(ctx, s.admin, s.request)
	claimed, _, _ := s.manager.claim(ctx)
	done := make(chan struct{})
	go func() { s.manager.run(ctx, claimed); close(done) }()
	for {
		s.manager.mu.Lock()
		_, running := s.manager.cancel[processing.ID]
		s.manager.mu.Unlock()
		if running {
			break
		}
		runtime.Gosched()
	}
	if err := s.manager.Cancel(ctx, s.admin, processing.ID); err != nil {
		t.Fatal(err)
	}
	<-done
	result, _ := s.manager.Job(ctx, s.admin, processing.ID)
	if result.State != "failed" || result.Error != "canceled" {
		t.Fatalf("processing cancel=%#v", result)
	}
	if _, err := s.manager.db.Exec(`UPDATE alignment_jobs SET state='processing',attempts=1,cancel_requested=0 WHERE id=?`, processing.ID); err != nil {
		t.Fatal(err)
	}
	restart, err := New(s.manager.db, s.manager.options)
	if err != nil {
		t.Fatal(err)
	}
	if err := restart.recover(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, _ := restart.Job(ctx, s.admin, processing.ID)
	if recovered.State != "pending" {
		t.Fatalf("recovered=%s", recovered.State)
	}
	if _, err := s.manager.db.Exec(`UPDATE alignment_jobs SET state='processing',attempts=2 WHERE id=?`, processing.ID); err != nil {
		t.Fatal(err)
	}
	if err := restart.recover(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, _ = restart.Job(ctx, s.admin, processing.ID)
	if recovered.State != "failed" {
		t.Fatalf("exhausted recovery=%s", recovered.State)
	}
}

func sha(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func testEPUB(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	write := func(name, value string) {
		f, e := z.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = io.WriteString(f, value); e != nil {
			t.Fatal(e)
		}
	}
	write("META-INF/container.xml", `<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`)
	write("book.opf", `<package><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`)
	write("chapter.xhtml", `<html><body><div><p>Alice was beginning to get very tired.</p></div></body></html>`)
	z.Close()
	return b.Bytes()
}
func fakeWorker(mode string) string {
	return `import json,sys,time
args=sys.argv
inp=json.load(open(args[args.index('--job-input')+1]))
out=args[args.index('--output')+1]
mode='` + mode + `'
if mode=='failure': sys.exit(2)
if mode=='sleep': time.sleep(10)
if mode=='malformed': open(out,'w').write('{');sys.exit(0)
s=inp['segments'][0]
segment={'id':s['id'],'ordinal':0,'text':s['text'],'normalized_text':' '.join(s['text'].split()),'epub':{'href':s['href'],'dom_path':s['dom_path'],'locator':{'type':'dom-element','dom_path':s['dom_path']}},'audio':{'resource':inp['audio_resource'],'start_ms':100,'end_ms':500},'status':'aligned','highlightable':True,'confidence_signals':{'score':0.9},'word_timings':[]}
if mode=='unresolved': segment['status']='unresolved';segment['highlightable']=False
segments=[segment]
artifact={'version':1,'tool':'whisperx 3.8.6','model':inp['model'],'epub_sha256':inp['epub_sha256'],'audio_sha256':inp['audio_sha256'],'segments':segments}
if mode=='wrong_hash': artifact['audio_sha256']='0'*64
json.dump(artifact,open(out,'w'))
`
}
