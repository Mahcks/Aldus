package acquisition

import (
	"fmt"
	"testing"
)

func TestNormalizeSearchResultsGroupsRanksAndDeduplicates(t *testing.T) {
	results := []Result{
		{Title: "The Unofficial Lord of the Rings Cookbook by Tom Grimm [ENG / EPUB]", Source: "Books", Size: 74},
		{Title: "J.R.R. Tolkien - The Lord of the Rings (2001) [EPUB]", Source: "Books", Size: 8},
		{Title: "The Lord of the Rings by J.R.R. Tolkien [ENG / M4B] Unabridged Narrated by Rob Inglis", Source: "Audio", Size: 555},
		{Title: "J.R.R. Tolkien - The Lord of the Rings (2001) [EPUB]", Source: "Books", Size: 8},
		{Title: "Lord of the Rings Movie 2160p", Source: "Video", Size: 999},
	}
	got := normalizeSearchResults("Lord of the Rings", results)
	if len(got) != 3 {
		t.Fatalf("results = %#v", got)
	}
	if got[0].CanonicalTitle != "The Lord of the Rings" || got[0].Author != "J.R.R. Tolkien" || got[0].Format != "EPUB" || got[0].Kind != "ebook" || got[0].Match != "exact" {
		t.Fatalf("first = %#v", got[0])
	}
	if got[1].Kind != "audiobook" || got[1].Format != "M4B" || got[1].Language != "en" || got[1].Edition != "Unabridged" || got[1].Narrator != "Rob Inglis" {
		t.Fatalf("audio = %#v", got[1])
	}
	if got[0].GroupKey != got[1].GroupKey {
		t.Fatalf("group keys differ: %#v %#v", got[0], got[1])
	}
	if got[2].Relevance >= got[0].Relevance {
		t.Fatalf("derivative ranked above exact: %#v", got)
	}
}

func TestNormalizeSearchResultsIsBounded(t *testing.T) {
	results := make([]Result, maxSearchResults+25)
	for i := range results {
		results[i] = Result{Title: fmt.Sprintf("Book %03d EPUB", i), Source: "Books", Size: int64(i)}
	}
	if got := normalizeSearchResults("Book", results); len(got) != maxSearchResults {
		t.Fatalf("len = %d", len(got))
	}
}

func TestNormalizeSearchResultsClustersTitleVariantsWithoutMergingDistinctWorks(t *testing.T) {
	results := []Result{
		{Title: "Lord of the Rings Series EPUB", Source: "Books", Size: 1},
		{Title: "Lord of the Rings Triology EPUB", Source: "Books", Size: 2},
		{Title: "The Lord of the Rings saga EPUB", Source: "Books", Size: 3},
		{Title: "Lord of the Rings The Hobbit EPUB", Source: "Books", Size: 4},
		{Title: "The Hobbit EPUB", Source: "Books", Size: 5},
		{Title: "The Unofficial Lord of the Rings Cookbook EPUB", Source: "Books", Size: 6},
	}
	got := normalizeSearchResults("Lord of the Rings", results)
	keys := make(map[string]string, len(got))
	for _, result := range got {
		keys[result.CanonicalTitle] = result.GroupKey
	}
	want := keys["Lord of the Rings Series"]
	for _, title := range []string{"Lord of the Rings Triology", "The Lord of the Rings saga", "Lord of the Rings The Hobbit"} {
		if keys[title] != want {
			t.Fatalf("%q group = %q, want %q", title, keys[title], want)
		}
	}
	for _, title := range []string{"The Hobbit", "The Unofficial Lord of the Rings Cookbook"} {
		if keys[title] == want {
			t.Fatalf("distinct work %q joined variant group", title)
		}
	}
}

func TestNormalizeSearchResultsRecognizesComicAndEbookContainers(t *testing.T) {
	results := []Result{
		{Title: "Heartstopper Volume 1 by Alice Oseman [CBZ]", Source: "Books", Size: 40},
		{Title: "Heartstopper Volume 1 by Alice Oseman [CBR]", Source: "Books", Size: 42},
		{Title: "Heartstopper Volume 1 by Alice Oseman [MOBI]", Source: "Books", Size: 8},
		{Title: "Heartstopper Volume 1 by Alice Oseman [AZW3]", Source: "Books", Size: 7},
		{Title: "Heartstopper Volume 1 by Alice Oseman [PDF]", Source: "Books", Size: 30},
	}
	got := normalizeSearchResults("Heartstopper Volume 1", results)
	if len(got) != len(results) {
		t.Fatalf("expected every recognized-format release to survive, got %#v", got)
	}
	for _, result := range got {
		if result.Kind != "ebook" {
			t.Fatalf("format %q misclassified as %q", result.Format, result.Kind)
		}
		if !isAudio("MP3") || isAudio(result.Format) {
			t.Fatalf("isAudio(%q) = true, want false", result.Format)
		}
	}
}

func TestParseDiscoveryResultToleratesMalformedTitles(t *testing.T) {
	for _, title := range []string{"", "[[[[", "EPUB", "... M4B ...", "📚"} {
		_ = parseDiscoveryResult("book", Result{Title: title})
	}
}
