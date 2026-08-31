package position

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
)

func BenchmarkKOReaderToCanonical5000Segments(b *testing.B) {
	ctx := context.Background()
	store, err := openTestStore(ctx, filepath.Join(b.TempDir(), "aldus.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { store.Close() })
	if err := store.SeedFixture(ctx); err != nil {
		b.Fatal(err)
	}
	if _, err := store.db.Exec(`DELETE FROM alignment_segments WHERE alignment_id=?`, FixtureAlignmentID); err != nil {
		b.Fatal(err)
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	for i := range 5000 {
		paragraph := EPUBParagraph{
			KOReaderFragment: i/100 + 1,
			KOReaderNodes: []KOReaderTextNode{{
				Path: fmt.Sprintf("html[1]/body[1]/p[%d]/text()[1]", i%100+1),
				Text: fmt.Sprintf("Benchmark paragraph %d", i),
			}},
		}
		if _, err := tx.Exec(`INSERT INTO alignment_segments(alignment_id,id,ordinal,text,epub_href,epub_locator,koreader_locator,audio_resource,audio_start_ms,audio_end_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`,
			FixtureAlignmentID, fmt.Sprintf("s%05d", i), i, paragraph.KOReaderNodes[0].Text,
			fmt.Sprintf("chapter-%03d.xhtml", i/100), fmt.Sprintf(`{"type":"epubcfi","value":"epubcfi(%d)"}`, i),
			MarshalKOReaderParagraph(paragraph), "book.m4b", i*1000, i*1000+900); err != nil {
			tx.Rollback()
			b.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}

	locator := KOReaderLocator{DocumentID: "fixture-koreader-document", Progress: "/body/DocFragment[50]/body/p[100]/text().5"}
	b.ResetTimer()
	for range b.N {
		if _, err := store.KOReaderToCanonical(ctx, locator); err != nil {
			b.Fatal(err)
		}
	}
}
