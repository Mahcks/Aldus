package acquisition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestFeedUsesExplicitFormatWithoutGuessingFromCategory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
			<item><title>Alice</title><guid>release-one</guid>
				<enclosure url="/one.torrent" length="123" type="application/x-bittorrent"/>
				<torznab:attr name="format" value="epub"/>
				<torznab:attr name="category" value="7020"/>
				<torznab:attr name="seeders" value="0"/>
				<torznab:attr name="peers" value="4"/>
			</item>
			<item><title>Alice unknown edition</title><enclosure url="/two.torrent"/>
				<torznab:attr name="category" value="7020"/>
			</item>
			<item><title>Alice EPUB</title><enclosure url="/three.nzb" type="application/x-nzb"/></item>
		</channel></rss>`)
	}))
	defer server.Close()

	client, _ := New(Options{IndexerKind: "torznab", IndexerURL: server.URL})
	report, err := client.SearchReport(context.Background(), "Alice")
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Results) != 1 || report.Indexers[0].Excluded != 2 {
		t.Fatalf("results=%+v; outcomes=%+v", report.Results, report.Indexers)
	}

	parsed := normalizeSearchResults("Alice", report.Results)
	if len(parsed) != 1 || parsed[0].Format != "EPUB" || parsed[0].Kind != "ebook" {
		t.Fatalf("explicit format lost: %+v", parsed)
	}
}

func TestFeedPreservesMetadataAndAlternativeProviders(t *testing.T) {
	zero := 0
	metadata := feedMetadata("opaque-provider-guid", "application/x-bittorrent", []feedAttribute{
		{Name: "category", Value: "7020"},
		{Name: "category", Value: "7020"},
		{Name: "category", Value: "invalid"},
		{Name: "seeders", Value: "0"},
		{Name: "peers", Value: "-1"},
		{Name: "format", Value: "epub"},
	})
	if metadata.GUID != "opaque-provider-guid" || len(metadata.Categories) != 1 || metadata.Categories[0] != 7020 {
		t.Fatalf("provider identity/categories lost: %+v", metadata)
	}

	if metadata.Seeders == nil || *metadata.Seeders != zero || metadata.Peers != nil {
		t.Fatal("unknown counts and zero seeders must remain distinct")
	}

	results := normalizeSearchResults("Alice", []Result{
		{Title: "Alice EPUB", Source: "A", Size: 100, DownloadURL: "https://a.invalid/release"},
		{Title: "Alice EPUB", Source: "B", Size: 100, DownloadURL: "https://b.invalid/release"},
	})
	if len(results) != 2 {
		t.Fatal("alternative provider release was discarded")
	}
}

func TestIndexerCapabilityDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{
			name: "books and audio",
			body: `<caps><searching><search available="yes"/></searching><categories>
				<category id="7000"/><category id="3000"><subcat id="3030"/></category>
			</categories></caps>`,
			want: "Book and audiobook categories are supported.",
		},
		{
			name: "unrelated",
			body: `<caps><categories><category id="2000"/></categories></caps>`,
			want: "No standard book or audiobook categories are advertised. Check this indexer in Prowlarr or Torznab.",
		},
		{
			name: "malformed",
			body: `<error description="private upstream message"/>`,
			want: "Category support could not be checked. Search results are shown separately.",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("t") != "caps" {
					t.Error("expected a capability request")
				}

				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()

			client, _ := New(Options{})
			if got := client.categorySupport(context.Background(), server.URL); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDiscoveryPreservesReleaseMetadataThroughSelection(t *testing.T) {
	ctx := context.Background()
	db := titleLifecycleFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "test"})
			fmt.Fprint(w, "Ok.")
		case "/api/v2/torrents/info":
			fmt.Fprint(w, "[]")
		case "/api/v2/torrents/add":
			fmt.Fprint(w, "Ok.")
		default:
			fmt.Fprint(w, `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
				<item><title>Alice EPUB</title><guid>internal-release-identity</guid>
					<enclosure url="magnet:?xt=urn:btih:0123456789012345678901234567890123456789" length="123"/>
					<torznab:attr name="category" value="7020"/>
					<torznab:attr name="seeders" value="0"/>
				</item>
			</channel></rss>`)
		}
	}))
	defer server.Close()

	client, _ := New(Options{IndexerKind: "torznab", IndexerURL: server.URL, QBitURL: server.URL})
	store := NewStore(db, client)
	store.metadataCache["alice"] = cachedMetadata{expires: time.Now().Add(time.Hour)}
	actor := auth.User{ID: "reader"}
	discovery, err := store.Discover(ctx, actor, "library", "source", "Alice")
	if err != nil || len(discovery.Results) != 1 {
		t.Fatalf("discovery=%+v; err=%v", discovery, err)
	}

	selected, err := store.SelectDiscovery(ctx, actor, "library", discovery.ID, discovery.Results[0].ID)
	if err != nil {
		t.Fatal(err)
	}

	var encoded string
	if err := db.QueryRow(`
		SELECT selected_release_metadata FROM acquisition_requests WHERE id=?
	`, selected.ID).Scan(&encoded); err != nil {
		t.Fatal(err)
	}

	var metadata ReleaseMetadata
	if err := json.Unmarshal([]byte(encoded), &metadata); err != nil {
		t.Fatal(err)
	}

	if metadata.GUID != "internal-release-identity" || metadata.Protocol != "torrent" || metadata.Seeders == nil || *metadata.Seeders != 0 {
		t.Fatalf("release metadata was lost during selection: %+v", metadata)
	}
}

func TestSelectionRejectsUnsupportedTransport(t *testing.T) {
	db := titleLifecycleFixture(t)
	if _, err := db.Exec(`
		UPDATE acquisition_results SET release_metadata='{"protocol":"unsupported"}' WHERE id='release'
	`); err != nil {
		t.Fatal(err)
	}

	client, _ := New(Options{})
	store := NewStore(db, client)
	_, err := store.Select(context.Background(), auth.User{ID: "reader"}, "library", "legacy", "release")
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsupported protocol reached submission: %v", err)
	}
}
