package opds

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/ingest"
)

type Dependencies struct {
	Auth    *auth.Store
	Catalog *catalog.Store
	Ingest  *ingest.Store
}

type userContextKey struct{}

type feed struct {
	XMLName xml.Name `xml:"feed"`
	XMLNS   string   `xml:"xmlns,attr"`
	ID      string   `xml:"id"`
	Title   string   `xml:"title"`
	Updated string   `xml:"updated"`
	Authors []author `xml:"author"`
	Links   []link   `xml:"link"`
	Entries []entry  `xml:"entry"`
}

type entry struct {
	ID      string   `xml:"id"`
	Title   string   `xml:"title"`
	Updated string   `xml:"updated"`
	Author  []author `xml:"author,omitempty"`
	Summary string   `xml:"summary"`
	Links   []link   `xml:"link"`
}

type author struct {
	Name string `xml:"name"`
}

type link struct {
	Rel  string `xml:"rel,attr"`
	Href string `xml:"href,attr"`
	Type string `xml:"type,attr,omitempty"`
}

type openSearchDescription struct {
	XMLName     xml.Name      `xml:"OpenSearchDescription"`
	XMLNS       string        `xml:"xmlns,attr"`
	ShortName   string        `xml:"ShortName"`
	Description string        `xml:"Description"`
	URL         openSearchURL `xml:"Url"`
}

type openSearchURL struct {
	Type     string `xml:"type,attr"`
	Template string `xml:"template,attr"`
}

func Handler(deps Dependencies) http.Handler {
	router := chi.NewRouter()
	router.Use(basicAuth(deps.Auth))
	router.Get("/", catalogFeed(deps.Catalog))
	router.Head("/", catalogFeed(deps.Catalog))
	router.Get("/search.xml", searchDescription())
	router.Head("/search.xml", searchDescription())
	router.Get("/media/{mediaID}", download(deps.Ingest))
	router.Head("/media/{mediaID}", download(deps.Ingest))
	router.Get("/media/{mediaID}/cover", embeddedCover(deps.Ingest))
	router.Head("/media/{mediaID}/cover", embeddedCover(deps.Ingest))
	router.Get("/covers/{coverID}", uploadedCover(deps.Catalog))
	router.Head("/covers/{coverID}", uploadedCover(deps.Catalog))
	return router
}

func basicAuth(store *auth.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			username, secret, ok := r.BasicAuth()
			if !ok {
				unauthorized(w)
				return
			}
			user, err := store.AuthenticateReader(r.Context(), username, secret, false)
			if err != nil {
				if errors.Is(err, auth.ErrInvalidCredentials) {
					unauthorized(w)
				} else {
					slog.Error("OPDS authentication failed", "error", err)
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
		})
	}
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="Aldus OPDS", charset="UTF-8"`)
	http.Error(w, "authentication required", http.StatusUnauthorized)
}

func catalogFeed(store *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page := 1
		if value := r.URL.Query().Get("page"); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 1 || parsed > 100000 {
				http.Error(w, "invalid page", http.StatusBadRequest)
				return
			}
			page = parsed
		}
		const pageSize = 50
		user, _ := r.Context().Value(userContextKey{}).(auth.User)
		search := r.URL.Query().Get("q")
		publications, hasMore, updated, err := store.OPDSPublications(r.Context(), user, search, pageSize, (page-1)*pageSize)
		if err != nil {
			slog.Error("OPDS catalog failed", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		self := opdsPageURL(search, page)
		result := feed{
			XMLNS: "http://www.w3.org/2005/Atom", ID: "urn:aldus:catalog", Title: "Aldus Library",
			Authors: []author{{Name: "Aldus"}},
			Links: []link{
				{Rel: "self", Href: self, Type: "application/atom+xml;profile=opds-catalog;kind=acquisition"},
				{Rel: "search", Href: "/opds/search.xml", Type: "application/opensearchdescription+xml"},
			},
		}
		if hasMore {
			result.Links = append(result.Links, link{Rel: "next", Href: opdsPageURL(search, page+1), Type: "application/atom+xml;profile=opds-catalog;kind=acquisition"})
		}
		for _, publication := range publications {
			item := entry{ID: "urn:aldus:media:" + publication.MediaID, Title: publication.Title, Updated: publication.UpdatedAt.Format(time.RFC3339), Summary: publication.LibraryName, Links: []link{{Rel: "http://opds-spec.org/acquisition", Href: "/opds/media/" + url.PathEscape(publication.MediaID), Type: "application/epub+zip"}}}
			if publication.Author != "" {
				item.Author = []author{{Name: publication.Author}}
			}
			if coverURL := opdsCoverURL(publication); coverURL != "" {
				item.Links = append(item.Links,
					link{Rel: "http://opds-spec.org/image", Href: coverURL, Type: publication.CoverType},
					link{Rel: "http://opds-spec.org/image/thumbnail", Href: coverURL, Type: publication.CoverType},
				)
			}
			result.Entries = append(result.Entries, item)
		}
		result.Updated = updated.Format(time.RFC3339)
		w.Header().Set("Content-Type", "application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8")
		w.Header().Set("Last-Modified", updated.Truncate(time.Second).Format(http.TimeFormat))
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write([]byte(xml.Header))
		_ = xml.NewEncoder(w).Encode(result)
	}
}

func opdsPageURL(search string, page int) string {
	values := url.Values{}
	if search != "" {
		values.Set("q", search)
	}
	if page > 1 {
		values.Set("page", strconv.Itoa(page))
	}
	if query := values.Encode(); query != "" {
		return "/opds/?" + query
	}
	return "/opds/"
}

func opdsCoverURL(publication catalog.OPDSPublication) string {
	switch publication.CoverSource {
	case "upload":
		return "/opds/covers/" + url.PathEscape(publication.CoverID)
	case "embedded":
		return "/opds/media/" + url.PathEscape(publication.CoverSourceID) + "/cover"
	default:
		return publication.CoverURL
	}
}

func searchDescription() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/opensearchdescription+xml; charset=utf-8")
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write([]byte(xml.Header))
		_ = xml.NewEncoder(w).Encode(openSearchDescription{
			XMLNS: "http://a9.com/-/spec/opensearch/1.1/", ShortName: "Aldus", Description: "Search the Aldus library",
			URL: openSearchURL{Type: "application/atom+xml;profile=opds-catalog;kind=acquisition", Template: "/opds/?q={searchTerms}"},
		})
	}
}

func download(store *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(userContextKey{}).(auth.User)
		file, media, err := store.Open(r.Context(), user, chi.URLParam(r, "mediaID"))
		if errors.Is(err, ingest.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			slog.Error("OPDS download failed", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		defer file.Close()
		if media.Kind != "epub" {
			http.NotFound(w, r)
			return
		}
		filename := media.OriginalFilename
		if filename == "" {
			filename = fmt.Sprintf("%s.epub", media.ID)
		}
		w.Header().Set("Content-Type", "application/epub+zip")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filepath.Base(filename)}))
		http.ServeContent(w, r, filename, media.CreatedAt, file)
	}
}

func embeddedCover(store *ingest.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(userContextKey{}).(auth.User)
		data, contentType, err := store.OpenCover(r.Context(), user, chi.URLParam(r, "mediaID"))
		writeCover(w, r, data, contentType, err)
	}
}

func uploadedCover(store *catalog.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(userContextKey{}).(auth.User)
		data, contentType, err := store.Cover(r.Context(), user, chi.URLParam(r, "coverID"))
		writeCover(w, r, data, contentType, err)
	}
}

func writeCover(w http.ResponseWriter, r *http.Request, data []byte, contentType string, err error) {
	if errors.Is(err, ingest.ErrNotFound) || errors.Is(err, catalog.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "read cover", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}
