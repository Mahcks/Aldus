package catalog

import (
	"strings"
	"testing"
)

func TestParseOpenLibraryCovers(t *testing.T) {
	values, err := parseOpenLibraryCovers(strings.NewReader(`{"docs":[{"cover_i":42,"title":"Alice","author_name":["Lewis Carroll"],"publisher":["Macmillan"],"isbn":["123"],"first_publish_year":1865},{"cover_i":42,"title":"Duplicate"},{"title":"No cover"}]}`))
	if err != nil || len(values) != 1 {
		t.Fatalf("covers = %#v, %v", values, err)
	}
	got := values[0]
	if got.Source != "open_library" || got.SourceID != "42" || got.Title != "Alice" || got.Author != "Lewis Carroll" || got.Publisher != "Macmillan" || got.ISBN != "123" || got.FirstPublishYear != 1865 || got.ImageURL != "https://covers.openlibrary.org/b/id/42-L.jpg?default=false" {
		t.Fatalf("cover = %#v", got)
	}
}
