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

func Handler(deps Dependencies) http.Handler {
	router := chi.NewRouter()
	router.Use(basicAuth(deps.Auth))
	router.Get("/", catalogFeed(deps.Catalog))
	router.Get("/media/{mediaID}", download(deps.Ingest))
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
		user, _ := r.Context().Value(userContextKey{}).(auth.User)
		publications, err := store.OPDSPublications(r.Context(), user)
		if err != nil {
			slog.Error("OPDS catalog failed", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		updated := time.Unix(0, 0).UTC()
		result := feed{XMLNS: "http://www.w3.org/2005/Atom", ID: "urn:aldus:catalog", Title: "Aldus Library", Links: []link{{Rel: "self", Href: "/opds/", Type: "application/atom+xml;profile=opds-catalog;kind=acquisition"}}}
		for _, publication := range publications {
			if publication.UpdatedAt.After(updated) {
				updated = publication.UpdatedAt
			}
			item := entry{ID: "urn:aldus:media:" + publication.MediaID, Title: publication.Title, Updated: publication.UpdatedAt.Format(time.RFC3339), Summary: publication.LibraryName, Links: []link{{Rel: "http://opds-spec.org/acquisition", Href: "/opds/media/" + url.PathEscape(publication.MediaID), Type: "application/epub+zip"}}}
			if publication.Author != "" {
				item.Author = []author{{Name: publication.Author}}
			}
			result.Entries = append(result.Entries, item)
		}
		result.Updated = updated.Format(time.RFC3339)
		w.Header().Set("Content-Type", "application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8")
		_, _ = w.Write([]byte(xml.Header))
		_ = xml.NewEncoder(w).Encode(result)
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
		http.ServeContent(w, r, filename, time.Time{}, file)
	}
}
