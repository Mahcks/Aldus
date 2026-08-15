package ingest

import (
	"archive/zip"
	"context"
	"os"
	"testing"
	"time"
)

func TestCoversReleasesQueryConnectionBeforeMediaLookup(t *testing.T) {
	s := testSetup(t)
	var workID string
	if err := s.store.db.QueryRow(`SELECT work_id FROM representations WHERE id=?`, s.epubID).Scan(&workID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if covers, err := s.store.Covers(ctx, s.admin, workID); err != nil || len(covers) != 0 {
		t.Fatalf("covers = %#v, %v", covers, err)
	}
}

func TestExtractEPUBCover(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "cover-*.epub")
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, value := range map[string]string{
		"META-INF/container.xml": `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`,
		"OPS/book.opf":           `<?xml version="1.0"?><package><metadata><meta name="cover" content="art"/></metadata><manifest><item id="art" href="cover.jpg" media-type="image/jpeg"/></manifest></package>`,
		"OPS/cover.jpg":          "not-decoded-here",
	} {
		entry, _ := archive.Create(name)
		_, _ = entry.Write([]byte(value))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	data, contentType, err := extractEPUBCover(file)
	if err != nil || string(data) != "not-decoded-here" || contentType != "image/jpeg" {
		t.Fatalf("cover = %q %q, %v", data, contentType, err)
	}
}
