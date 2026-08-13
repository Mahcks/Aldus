package position

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImportAliceEPUB(t *testing.T) {
	filename := filepath.Join("..", "..", "..", "test-fixtures", "alice", "media", "alice.epub")
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Skip("run test-fixtures/alice/fetch.sh for the real-media vector")
	}
	book, err := ImportEPUB(filename)
	if err != nil {
		t.Fatal(err)
	}
	if book.SHA256 != "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c" {
		t.Fatalf("SHA-256 = %s", book.SHA256)
	}
	if book.Package != "OEBPS/content.opf" || len(book.Spine) != 15 {
		t.Fatalf("package = %q, spine items = %d", book.Package, len(book.Spine))
	}
	const first = "Alice was beginning to get very tired of sitting by her sister on the bank"
	found := false
	for _, paragraph := range book.Paragraphs {
		if paragraph.Href == "OEBPS/6260297267691793459_11-h-1.htm.xhtml" && paragraph.DOMPath == "html[1]/body[1]/div[1]/p[1]" && len(paragraph.Text) >= len(first) && paragraph.Text[:len(first)] == first {
			found = true
		}
	}
	if !found {
		t.Fatal("Chapter 1 first paragraph did not retain its real resource and DOM path")
	}
}
