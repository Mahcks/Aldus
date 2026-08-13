package seedalice

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/position"
)

func TestSeed(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
	fixture := filepath.Join(root, "test-fixtures", "alice")
	if _, err := os.Stat(filepath.Join(fixture, "media", "alice.epub")); err != nil {
		t.Skip("run make fixture")
	}
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), filepath.Join(dataDir, "aldus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	t.Setenv("ALDUS_ENV", "development")
	seed := func() {
		if err := Seed(context.Background(), db, dataDir, filepath.Join(fixture, "media"), filepath.Join(fixture, "automatic", "hybrid-whisperx", "alignment.json")); err != nil {
			t.Fatal(err)
		}
	}
	seed()
	seed()
	var work, epubKind, audioKind, state string
	if err := db.QueryRow(`SELECT w.title,e.kind,a.kind,al.state FROM works w JOIN representations e ON e.work_id=w.id AND e.id=? JOIN representations a ON a.work_id=w.id AND a.id=? JOIN alignments al ON al.id=? WHERE w.id=?`, EPUBRepID, AudioRepID, AlignmentID, WorkID).Scan(&work, &epubKind, &audioKind, &state); err != nil {
		t.Fatal(err)
	}
	if work != "Alice's Adventures in Wonderland" || epubKind != "epub" || audioKind != "audiobook" || state != "ready" {
		t.Fatalf("invalid product graph: %q %q %q %q", work, epubKind, audioKind, state)
	}
	var epub, audio string
	if err := db.QueryRow(`SELECT (SELECT sha256 FROM media WHERE id=?),(SELECT sha256 FROM media WHERE id=?)`, EPUBMediaID, AudioMediaID).Scan(&epub, &audio); err != nil {
		t.Fatal(err)
	}
	if epub != epubHash || audio != audioHash {
		t.Fatal("frozen media hashes changed")
	}
	var inputs, segments, highlightable, unresolved int
	if err := db.QueryRow(`SELECT (SELECT COUNT(*) FROM alignment_inputs WHERE alignment_id=?),(SELECT COUNT(*) FROM alignment_segments WHERE alignment_id=?),(SELECT COUNT(*) FROM alignment_segments WHERE alignment_id=? AND highlightable=1),(SELECT COUNT(*) FROM alignment_segments WHERE alignment_id=? AND alignment_status='unresolved' AND highlightable=0)`, AlignmentID, AlignmentID, AlignmentID, AlignmentID).Scan(&inputs, &segments, &highlightable, &unresolved); err != nil {
		t.Fatal(err)
	}
	if inputs != 2 || segments != 87 || highlightable != 85 || unresolved != 2 {
		t.Fatalf("invalid alignment evidence: %d %d %d %d", inputs, segments, highlightable, unresolved)
	}
	var locator string
	if err := db.QueryRow(`SELECT epub_locator FROM alignment_segments WHERE alignment_id=? AND id='item4-s57'`, AlignmentID).Scan(&locator); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(locator, `"start":{"dom_path":"html[1]/body[1]/div[1]/p[14]/text()[1]","node_offset":1}`) || !strings.Contains(locator, `"end":{"dom_path":"html[1]/body[1]/div[1]/p[14]/text()[1]","node_offset":183}`) {
		t.Fatalf("seeded locator lost exact range: %s", locator)
	}
	var firstID, lastID string
	if err := db.QueryRow(`SELECT (SELECT id FROM alignment_segments WHERE alignment_id=? ORDER BY ordinal LIMIT 1),(SELECT id FROM alignment_segments WHERE alignment_id=? ORDER BY ordinal DESC LIMIT 1)`, AlignmentID, AlignmentID).Scan(&firstID, &lastID); err != nil {
		t.Fatal(err)
	}
	if firstID != "item4-s0" || lastID != "item4-s86" {
		t.Fatalf("canonical IDs changed: %s %s", firstID, lastID)
	}
	canonical, err := position.New(db).EPUBToCanonical(context.Background(), AlignmentID, position.EPUBLocator{Href: "OEBPS/6260297267691793459_11-h-1.htm.xhtml", Locator: []byte(`{"type":"dom-element","dom_path":"html[1]/body[1]/div[1]/p[1]"}`)})
	if err != nil || canonical.SegmentID != "item4-s1" {
		t.Fatalf("resolve seeded paragraph: %#v %v", canonical, err)
	}
	target, err := position.New(db).CanonicalToAudio(context.Background(), canonical)
	if err != nil || target.TimestampMS != 33700 {
		t.Fatalf("resolve seeded audio: %#v %v", target, err)
	}
	canonical, err = position.New(db).EPUBToCanonical(context.Background(), AlignmentID, position.EPUBLocator{Href: "OEBPS/6260297267691793459_11-h-1.htm.xhtml", Locator: []byte(`{"type":"dom-element","dom_path":"html[1]/body[1]/div[1]/p[14]","segment_id":"item4-s60"}`), Offset: 500_000})
	if err != nil || canonical.SegmentID != "item4-s60" || canonical.Offset != 500_000 {
		t.Fatalf("resolve exact within-paragraph segment: %#v %v", canonical, err)
	}

	rows, err := db.Query(`SELECT id,audio_resource,audio_start_ms,audio_end_ms FROM alignment_segments WHERE alignment_id=? AND highlightable=1 ORDER BY ordinal LIMIT 20`, AlignmentID)
	if err != nil {
		t.Fatal(err)
	}
	type auditPosition struct {
		id, resource string
		start, end   int64
	}
	var positions []auditPosition
	for rows.Next() {
		var item auditPosition
		if rows.Scan(&item.id, &item.resource, &item.start, &item.end) != nil {
			t.Fatal("scan audit segment")
		}
		positions = append(positions, item)
	}
	rows.Close()
	for checked, item := range positions {
		audio, err := position.New(db).CanonicalToAudio(context.Background(), position.Canonical{AlignmentID: AlignmentID, SegmentID: item.id, Offset: 430_000})
		if err != nil || audio.Resource != item.resource || audio.TimestampMS < item.start || audio.TimestampMS > item.end {
			t.Fatalf("read audit %s: %#v %v", item.id, audio, err)
		}
		if checked < 10 {
			back, err := position.New(db).AudioToCanonical(context.Background(), AlignmentID, position.AudioLocator{Resource: item.resource, TimestampMS: item.start + (item.end-item.start)*2/3})
			if err != nil || back.SegmentID != item.id || back.Offset < 0 || back.Offset > 1_000_000 {
				t.Fatalf("listen audit %s: %#v %v", item.id, back, err)
			}
		}
	}
	if len(positions) != 20 {
		t.Fatalf("audited %d positions", len(positions))
	}
}

func TestProductionGate(t *testing.T) {
	t.Setenv("ALDUS_ENV", "production")
	if err := Seed(context.Background(), nil, "", "", ""); err == nil {
		t.Fatal("production seed accepted")
	}
}
