package acquisition

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrSearchFailed      = errors.New("search failed")
	ErrUnavailable       = errors.New("acquisition is not configured")
	ErrSubmissionUnknown = errors.New("qBittorrent submission outcome is unknown")
)

type Options struct {
	IndexerKind   string
	IndexerURL    string
	IndexerAPIKey string
	NYTAPIKey     string
	QBitURL       string
	QBitUsername  string
	QBitPassword  string
	Category      string
	DownloadRoot  string
}

type Client struct {
	options Options
	http    *http.Client
}

type Result struct {
	Metadata    ReleaseMetadata
	Title       string
	DownloadURL string
	Source      string
	Size        int64
	Published   time.Time
}

type Indexer struct {
	ID       int
	Name     string
	Protocol string
	Enabled  bool
}

type Download struct {
	Hash        string
	Name        string
	State       string
	ContentPath string
	Tags        string
	Progress    float64
	Size        int64
	Seeds       int
	Peers       int
}

func (d Download) HasTag(tag string) bool {
	for value := range strings.SplitSeq(d.Tags, ",") {
		if strings.TrimSpace(value) == tag {
			return true
		}
	}
	return false
}

func (d Download) ReadyForImport() bool {
	if d.Progress < 1 || d.ContentPath == "" {
		return false
	}
	switch strings.ToLower(d.State) {
	case "uploading", "stalledup", "queuedup", "forcedup", "pausedup", "stoppedup":
		return true
	default:
		return false
	}
}

func New(options Options) (*Client, error) {
	if options.IndexerKind != "" && options.IndexerKind != "prowlarr" && options.IndexerKind != "torznab" {
		return nil, fmt.Errorf("invalid indexer kind %q", options.IndexerKind)
	}
	for _, raw := range []string{options.IndexerURL, options.QBitURL} {
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
			return nil, fmt.Errorf("invalid acquisition URL %q", raw)
		}
	}
	return &Client{
		options: options,
		http: &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if req.URL.Scheme == "magnet" && validDownloadURL(req.URL.String()) {
					return magnetRedirectError{URL: req.URL.String()}
				}
				if len(via) > 0 && !sameOrigin(via[0].URL, req.URL) {
					return errors.New("cross-origin redirect refused")
				}
				return nil
			},
		},
	}, nil
}

type IndexerOutcome struct {
	ID           int
	Capabilities string
	Name         string
	Error        string
	Results      int
	Excluded     int
}

type SearchReport struct {
	Results   []Result
	Indexers  []IndexerOutcome
	Reachable bool
}

func sameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func validDownloadURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil {
		return false
	}

	if u.Scheme == "magnet" {
		return strings.HasPrefix(strings.ToLower(u.Query().Get("xt")), "urn:btih:")
	}

	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
