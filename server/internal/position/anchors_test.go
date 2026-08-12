package position

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type anchorFixture struct {
	Version              int      `json:"version"`
	EPUBSHA256           string   `json:"epub_sha256"`
	AudioSHA256          string   `json:"audio_sha256"`
	KOReaderDocumentHash string   `json:"koreader_document_hash"`
	Anchors              []anchor `json:"anchors"`
}

type anchor struct {
	ID             string `json:"id"`
	Text           string `json:"text"`
	NormalizedText string `json:"normalized_text"`
	EPUB           struct {
		Href  string `json:"href"`
		CFI   string `json:"cfi"`
		Start struct {
			DOMPath    string `json:"dom_path"`
			NodeOffset int    `json:"node_offset"`
		} `json:"start"`
		End struct {
			DOMPath    string `json:"dom_path"`
			NodeOffset int    `json:"node_offset"`
		} `json:"end"`
	} `json:"epub"`
	Audio struct {
		Resource    string `json:"resource"`
		TimestampMS int64  `json:"timestamp_ms"`
		Seek        struct {
			RequestedMS  int64 `json:"requested_ms"`
			ReportedMS   int64 `json:"reported_ms"`
			DifferenceMS int64 `json:"difference_ms"`
		} `json:"seek"`
	} `json:"audio"`
	Canonical struct {
		SegmentID string `json:"segment_id"`
		Offset    int    `json:"offset"`
	} `json:"canonical"`
	KOReaderXPointer string `json:"koreader_xpointer"`
}

func TestSavedAliceAnchors(t *testing.T) {
	root := filepath.Join("..", "..", "..", "test-fixtures", "alice")
	data, err := os.ReadFile(filepath.Join(root, "anchors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture anchorFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Version != 1 || fixture.EPUBSHA256 != "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c" || fixture.AudioSHA256 != "6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a" || fixture.KOReaderDocumentHash != "efbf04efc9d43ecd89a033b329f49bdb" {
		t.Fatal("anchor fixture references a different media revision")
	}
	if len(fixture.Anchors) == 0 {
		t.Skip("no manually authored anchors exported yet")
	}

	book, err := ImportEPUB(filepath.Join(root, "media", "alice.epub"))
	if os.IsNotExist(err) {
		t.Skip("run make fixture for real EPUB validation")
	}
	if err != nil {
		t.Fatal(err)
	}
	store := testStoreWithoutFixture(t)
	seedSavedAnchors(t, store, fixture)
	for _, anchor := range fixture.Anchors {
		t.Run(anchor.ID, func(t *testing.T) {
			if anchor.ID == "" || anchor.Text == "" || anchor.NormalizedText == "" || anchor.EPUB.Href == "" || anchor.EPUB.Start.DOMPath == "" || anchor.EPUB.End.DOMPath == "" || anchor.EPUB.CFI == "" || anchor.Audio.Resource == "" || anchor.Canonical.SegmentID != anchor.ID || anchor.Canonical.Offset != 0 {
				t.Fatal("anchor has missing or inconsistent fields")
			}
			if strings.Join(strings.Fields(anchor.Text), " ") != anchor.NormalizedText {
				t.Fatal("normalized text does not match authoritative selected text")
			}
			if anchor.Audio.Seek.ReportedMS-anchor.Audio.Seek.RequestedMS != anchor.Audio.Seek.DifferenceMS || anchor.Audio.TimestampMS != anchor.Audio.Seek.RequestedMS {
				t.Fatal("seek diagnostic does not match captured timestamp")
			}
			if !resourceContains(book, anchor.EPUB.Href, anchor.NormalizedText) {
				t.Fatal("EPUB locator does not resolve to exact expected text")
			}
			locatorJSON, _ := json.Marshal(map[string]string{"type": "epubcfi", "value": anchor.EPUB.CFI})
			canonical, err := store.EPUBToCanonical(context.Background(), FixtureAlignmentID, EPUBLocator{Href: anchor.EPUB.Href, Locator: locatorJSON})
			if err != nil {
				t.Fatal(err)
			}
			audio, err := store.CanonicalToAudio(context.Background(), canonical)
			if err != nil || audio.TimestampMS != anchor.Audio.TimestampMS {
				t.Fatalf("EPUB -> canonical -> audio = %#v, %v", audio, err)
			}
			canonical, err = store.AudioToCanonical(context.Background(), FixtureAlignmentID, AudioLocator{Resource: anchor.Audio.Resource, TimestampMS: anchor.Audio.TimestampMS})
			if err != nil {
				t.Fatal(err)
			}
			epub, err := store.CanonicalToEPUB(context.Background(), canonical)
			if err != nil || epub.Href != anchor.EPUB.Href || string(epub.Locator) != string(locatorJSON) || !resourceContains(book, epub.Href, anchor.NormalizedText) {
				t.Fatalf("audio -> canonical -> EPUB = %#v, %v", epub, err)
			}
		})
	}
}

func testStoreWithoutFixture(t *testing.T) *Store {
	t.Helper()
	store, err := openTestStore(context.Background(), filepath.Join(t.TempDir(), "anchors.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func seedSavedAnchors(t *testing.T, store *Store, fixture anchorFixture) {
	t.Helper()
	ctx := context.Background()
	for _, statement := range []string{
		`INSERT INTO libraries (id,name,created_at,updated_at) VALUES ('fixture-library','Fixture','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z')`,
		`INSERT INTO works (id,library_id,title,created_at,updated_at) VALUES ('fixture-work','fixture-library','Alice','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z')`,
		`INSERT INTO representations (id,work_id,kind,label,created_at,updated_at) VALUES ('fixture-epub-representation','fixture-work','epub','EPUB','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z')`,
		`INSERT INTO representations (id,work_id,kind,label,created_at,updated_at) VALUES ('fixture-audio-representation','fixture-work','audio','Audio','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z')`,
		fmt.Sprintf(`INSERT INTO media (id,representation_id,kind,path,sha256,created_at) VALUES ('fixture-epub','fixture-epub-representation','epub','alice.epub','%s','2026-08-11T00:00:00Z')`, fixture.EPUBSHA256),
		fmt.Sprintf(`INSERT INTO media (id,representation_id,kind,path,sha256,created_at) VALUES ('fixture-audio','fixture-audio-representation','audio','alice-chapter-01.mp3','%s','2026-08-11T00:00:00Z')`, fixture.AudioSHA256),
		`INSERT INTO alignments (id, epub_media_id, audio_media_id, revision, state, created_at) VALUES ('fixture-alignment', 'fixture-epub', 'fixture-audio', 1, 'ready', '2026-08-11T00:00:00Z')`,
	} {
		if _, err := store.db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	for index, anchor := range fixture.Anchors {
		end := anchor.Audio.TimestampMS + 1
		if index+1 < len(fixture.Anchors) {
			end = fixture.Anchors[index+1].Audio.TimestampMS
		}
		if end <= anchor.Audio.TimestampMS {
			t.Fatalf("anchors are not in increasing audio order at %s", anchor.ID)
		}
		locator, _ := json.Marshal(map[string]string{"type": "epubcfi", "value": anchor.EPUB.CFI})
		koreader := anchor.KOReaderXPointer
		if koreader == "" {
			koreader = "unverified:" + anchor.ID
		}
		if _, err := store.db.ExecContext(ctx, `INSERT INTO alignment_segments (alignment_id,id,ordinal,text,epub_href,epub_locator,koreader_locator,audio_resource,audio_start_ms,audio_end_ms) VALUES (?,?,?,?,?,?,?,?,?,?)`, FixtureAlignmentID, anchor.ID, index, anchor.Text, anchor.EPUB.Href, string(locator), koreader, anchor.Audio.Resource, anchor.Audio.TimestampMS, end); err != nil {
			t.Fatal(err)
		}
	}
}

func resourceContains(book EPUB, href, text string) bool {
	for _, paragraph := range book.Paragraphs {
		if paragraph.Href == href && strings.Contains(paragraph.Text, text) {
			return true
		}
	}
	return false
}
