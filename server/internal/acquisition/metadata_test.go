package acquisition

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type metadataRoundTripFunc func(*http.Request) (*http.Response, error)

func (f metadataRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestMetadataRequiresStrongTitleMatchAndDegradesSafely(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("missing User-Agent")
		}
		_, _ = w.Write([]byte(`{"docs":[{"key":"/works/OL1W","title":"The Lord of the Rings","author_name":["J.R.R. Tolkien"],"first_publish_year":1954,"isbn":["9780000000000"],"cover_i":42},{"key":"/works/OL2W","title":"The Lord of the Rings Series","author_name":["J.R.R. Tolkien"],"cover_i":43},{"key":"/works/OL3W","title":"The Lord of the Rings Trivia Quiz","author_name":["Someone Else"]},{"key":"/works/OL4W","title":"The Lord of the Rings Sheet Music","author_name":["Howard Shore"]}]}`))
	}))
	defer server.Close()

	got, err := metadataFrom(context.Background(), server.Client(), server.URL, "Lord of the Rings")
	if err != nil || len(got) != 2 || got[0].ID != "OL1W" || got[0].Title != "The Lord of the Rings" || got[0].Author != "J.R.R. Tolkien" || got[0].Year != 1954 || got[0].ISBN == "" || got[0].CoverURL == "" {
		t.Fatalf("metadata = %+v, %v", got, err)
	}
	if match := matchingMetadata("Lord of the Rings Series", "J R R Tolkien", got); match.Title != "The Lord of the Rings Series" || match.CoverURL == "" {
		t.Fatalf("group metadata = %+v", match)
	}
	if match := matchingMetadata("Lord of the Rings Saga", "J R R Tolkien", got); match.Title != "The Lord of the Rings" {
		t.Fatalf("title variant metadata = %+v", match)
	}
	got, err = metadataFrom(context.Background(), server.Client(), server.URL, "The Hobbit")
	if err != nil || len(got) != 0 {
		t.Fatalf("unrelated metadata = %+v, %v", got, err)
	}

	server.Close()
	if _, err := metadataFrom(context.Background(), server.Client(), server.URL, "Lord of the Rings"); err == nil {
		t.Fatal("remote failure was not reported")
	}
}

func TestMetadataSearchPrefersTheBookInsideASeriesQuery(t *testing.T) {
	if metadataSearchScore("Hunger Games Catching Fire", "Catching Fire") <= metadataSearchScore("Hunger Games Catching Fire", "The Hunger Games Trilogy Hunger Games Catching Fire Mockingjay") {
		t.Fatal("buried the requested book beneath a series bundle")
	}
}

func TestMetadataSearchDoesNotHideMatchingTitles(t *testing.T) {
	docs := make([]string, 7)
	for i := range docs {
		docs[i] = fmt.Sprintf(`{"key":"/works/OL%dW","title":"Alice Adventures %d","author_name":["Lewis Carroll"]}`, i, i)
	}
	client := Client{http: &http.Client{Transport: metadataRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Query().Get("limit") != "25" {
			t.Fatalf("limit = %q, want 25", request.URL.Query().Get("limit"))
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(fmt.Sprintf(`{"docs":[%s]}`, strings.Join(docs, ","))))}, nil
	})}}

	got, err := client.metadata(context.Background(), "Alice Adventures")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 7 {
		t.Fatalf("got %d results, want all 7", len(got))
	}
}

func TestEnglishEditionTitleRepairsLocalizedWorkTitle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"entries":[{"title":"Fatta Eld","languages":[{"key":"/languages/swe"}]},{"title":"Catching Fire","languages":[{"key":"/languages/eng"}]}]}`))
	}))
	defer server.Close()

	title, err := englishEditionTitleFrom(context.Background(), server.Client(), server.URL, "Hunger Games Catching Fire")
	if err != nil || title != "Catching Fire" {
		t.Fatalf("title=%q err=%v", title, err)
	}
}

func TestLikelyPairsAreConservativeAndOpaque(t *testing.T) {
	results := []SearchResult{
		{ID: "ebook-id", CanonicalTitle: "The Lord of the Rings", Author: "J R R Tolkien", Format: "EPUB", Language: "en"},
		{ID: "audio-id", CanonicalTitle: "The Lord of the Rings", Author: "J.R.R. Tolkien", Format: "M4B", Language: "en"},
		{ID: "translation-id", CanonicalTitle: "The Lord of the Rings", Author: "J R R Tolkien", Format: "MP3", Language: "de"},
		{ID: "other-id", CanonicalTitle: "The Hobbit", Author: "J R R Tolkien", Format: "M4B", Language: "en"},
		{ID: "related-id", CanonicalTitle: "The Lord of the Rings Saga", Author: "J R R Tolkien", Format: "EPUB", Language: "en"},
	}
	addLikelyPairs(results)
	if len(results[0].LikelyPairIDs) != 1 || results[0].LikelyPairIDs[0] != "audio-id" || results[0].MatchConfidence != "likely" {
		t.Fatalf("ebook pairing = %+v", results[0])
	}
	if len(results[2].LikelyPairIDs) != 0 || len(results[3].LikelyPairIDs) != 0 || len(results[4].LikelyPairIDs) != 1 || results[4].LikelyPairIDs[0] != "audio-id" {
		t.Fatalf("false positive pair: translation=%+v other=%+v related=%+v", results[2], results[3], results[4])
	}
}

func TestPairRequiresConcreteOppositeFormatsWithSameCanonicalTitle(t *testing.T) {
	ebook := SearchResult{CanonicalTitle: "Lord of the Rings", Author: "J R R Tolkien", Format: "EPUB"}
	audio := SearchResult{CanonicalTitle: "The Lord of the Rings", Format: "M4B"}
	if score, _ := pairScore(ebook, audio); score < 70 {
		t.Fatalf("exact title score = %d, want likely", score)
	}
	if score, _ := pairScore(ebook, SearchResult{CanonicalTitle: "Lord of the Rings Saga", Format: "M4B"}); score < 70 {
		t.Fatalf("title variant score = %d, want likely", score)
	}
	for _, other := range []SearchResult{
		{CanonicalTitle: "The Hobbit", Format: "M4B"},
		{CanonicalTitle: "Lord of the Rings", Format: "EPUB"},
		{CanonicalTitle: "Lord of the Rings", Format: "M4B", Abridged: true},
		{CanonicalTitle: "Lord of the Rings", Author: "Another Author", Format: "M4B"},
	} {
		if score, _ := pairScore(ebook, other); score != 0 {
			t.Fatalf("false positive %+v scored %d", other, score)
		}
	}
}

func TestAbridgedAudioLowersPairBelowLikelyThreshold(t *testing.T) {
	ebook := SearchResult{CanonicalTitle: "Dune", Author: "Frank Herbert", Format: "EPUB"}
	audio := SearchResult{CanonicalTitle: "Dune", Author: "Frank Herbert", Format: "M4B", Abridged: true}
	if score, _ := pairScore(ebook, audio); score >= 70 {
		t.Fatalf("abridged score = %d, want below likely threshold", score)
	}
}
