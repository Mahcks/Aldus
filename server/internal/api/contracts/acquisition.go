package contracts

import "time"

type AcquisitionRequest struct {
	TorrentOwnership    string    `json:"torrent_ownership,omitempty" tstype:"'created' | 'adopted' | 'unknown'"`
	ID                  string    `json:"id"`
	LibraryID           string    `json:"library_id"`
	RequestedBy         string    `json:"requested_by"`
	SourceID            string    `json:"source_id,omitempty"`
	Query               string    `json:"query"`
	Status              string    `json:"status" tstype:"'requested' | 'queued'"`
	DownloadState       string    `json:"download_state,omitempty" tstype:"'' | 'downloading' | 'ready'"`
	DownloadError       string    `json:"download_error,omitempty"`
	FulfillmentState    string    `json:"fulfillment_state" tstype:"'awaiting_selection' | 'submitting' | 'downloading' | 'scanning' | 'needs_review' | 'available' | 'failed'"`
	ScanID              string    `json:"scan_id,omitempty"`
	ProposalID          string    `json:"proposal_id,omitempty"`
	WorkID              string    `json:"work_id,omitempty"`
	PairID              string    `json:"pair_id,omitempty"`
	SelectedTitle       string    `json:"selected_title,omitempty"`
	SelectedSource      string    `json:"selected_source,omitempty"`
	SelectedSize        int64     `json:"selected_size,omitempty"`
	SelectedPublishedAt time.Time `json:"selected_published_at,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
	CanRetry            bool      `json:"can_retry,omitempty"`
	CanCancel           bool      `json:"can_cancel,omitempty"`
	CanDismiss          bool      `json:"can_dismiss,omitempty"`
}

type AcquisitionResult struct {
	Protocol        string    `json:"protocol,omitempty"`
	Categories      []int     `json:"categories,omitempty"`
	Seeders         *int      `json:"seeders,omitempty"`
	Peers           *int      `json:"peers,omitempty"`
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	Source          string    `json:"source"`
	CanonicalTitle  string    `json:"canonical_title"`
	Author          string    `json:"author,omitempty"`
	Language        string    `json:"language,omitempty"`
	Format          string    `json:"format"`
	Kind            string    `json:"kind" tstype:"'ebook' | 'audiobook'"`
	Edition         string    `json:"edition,omitempty"`
	Narrator        string    `json:"narrator,omitempty"`
	Year            int       `json:"year,omitempty"`
	ISBN            string    `json:"isbn,omitempty"`
	CoverURL        string    `json:"cover_url,omitempty"`
	Abridged        bool      `json:"abridged,omitempty"`
	GroupKey        string    `json:"group_key"`
	Match           string    `json:"match" tstype:"'exact' | 'related'"`
	Size            int64     `json:"size"`
	Published       time.Time `json:"published,omitempty"`
	Relevance       int       `json:"relevance"`
	MatchConfidence string    `json:"match_confidence,omitempty" tstype:"'' | 'likely'"`
	MatchReasons    []string  `json:"match_reasons,omitempty"`
	LikelyPairIDs   []string  `json:"likely_pair_ids,omitempty"`
}

type CreateAcquisitionRequest struct {
	Query    string `json:"query"`
	SourceID string `json:"source_id"`
}
type SelectAcquisitionRequest struct {
	ResultID string `json:"result_id"`
}

type SelectAcquisitionPairRequest struct {
	ResultIDs []string `json:"result_ids"`
}

type AcquisitionPair struct {
	ID       string               `json:"id"`
	Requests []AcquisitionRequest `json:"requests"`
}

type AcquisitionDiscovery struct {
	Report  *AcquisitionSearchReport `json:"report,omitempty"`
	ID      string                   `json:"id"`
	Results []AcquisitionResult      `json:"results"`
}

type AcquisitionSettings struct {
	IndexerKind             string `json:"indexer_kind" tstype:"'prowlarr' | 'torznab'"`
	IndexerURL              string `json:"indexer_url"`
	HasIndexerAPIKey        bool   `json:"has_indexer_api_key"`
	HasNYTAPIKey            bool   `json:"has_nyt_api_key"`
	QBitTorrentURL          string `json:"qbittorrent_url"`
	QBitTorrentUsername     string `json:"qbittorrent_username"`
	HasQBitTorrentPassword  bool   `json:"has_qbittorrent_password"`
	QBitTorrentCategory     string `json:"qbittorrent_category"`
	QBitTorrentDownloadRoot string `json:"qbittorrent_download_root"`
}

type UpdateAcquisitionSettingsRequest struct {
	IndexerKind             string `json:"indexer_kind" tstype:"'prowlarr' | 'torznab'"`
	IndexerURL              string `json:"indexer_url"`
	IndexerAPIKey           string `json:"indexer_api_key"`
	NYTAPIKey               string `json:"nyt_api_key"`
	QBitTorrentURL          string `json:"qbittorrent_url"`
	QBitTorrentUsername     string `json:"qbittorrent_username"`
	QBitTorrentPassword     string `json:"qbittorrent_password"`
	QBitTorrentCategory     string `json:"qbittorrent_category"`
	QBitTorrentDownloadRoot string `json:"qbittorrent_download_root"`
}

type AcquisitionConnectionStatus struct {
	Search           *AcquisitionSearchReport `json:"search,omitempty"`
	FileVisibility   string                   `json:"file_visibility,omitempty" tstype:"'not_tested' | 'ok' | 'failed'"`
	FileError        string                   `json:"file_error,omitempty"`
	ProwlarrOK       bool                     `json:"prowlarr_ok"`
	IndexerCount     int                      `json:"indexer_count"`
	ProwlarrError    string                   `json:"prowlarr_error,omitempty"`
	QBitTorrentOK    bool                     `json:"qbittorrent_ok"`
	QBitTorrentError string                   `json:"qbittorrent_error,omitempty"`
}

type AcquisitionCapabilities struct {
	Enabled      bool                     `json:"enabled"`
	Destinations []AcquisitionDestination `json:"destinations"`
}

type AcquisitionDestination struct {
	LibraryID   string `json:"library_id"`
	LibraryName string `json:"library_name"`
	SourceID    string `json:"source_id"`
	SourceName  string `json:"source_name"`
}

type AcquisitionTracker struct {
	Requests    []AcquisitionRequest `json:"requests"`
	UnreadCount int                  `json:"unread_count"`
}

// AcquisitionSearchReport describes the same search that produced the releases.
// It contains no download URLs and is only presented to administrators.
type AcquisitionSearchReport struct {
	Reachable bool                        `json:"reachable"`
	Indexers  []AcquisitionIndexerOutcome `json:"indexers"`
}

type AcquisitionIndexerOutcome struct {
	Capabilities string `json:"capabilities,omitempty"`
	Name         string `json:"name"`
	Error        string `json:"error,omitempty"`
	Results      int    `json:"results"`
	Excluded     int    `json:"excluded"`
}

type AcquisitionSearchResponse struct {
	Results []AcquisitionResult     `json:"results"`
	Report  AcquisitionSearchReport `json:"report"`
}
