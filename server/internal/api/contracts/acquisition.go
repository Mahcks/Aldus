package contracts

import "time"

type AcquisitionRequest struct {
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
	SelectedTitle       string    `json:"selected_title,omitempty"`
	SelectedSource      string    `json:"selected_source,omitempty"`
	SelectedSize        int64     `json:"selected_size,omitempty"`
	SelectedPublishedAt time.Time `json:"selected_published_at,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type AcquisitionResult struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Source    string    `json:"source"`
	Size      int64     `json:"size"`
	Published time.Time `json:"published,omitempty"`
}

type CreateAcquisitionRequest struct {
	Query    string `json:"query"`
	SourceID string `json:"source_id"`
}
type SelectAcquisitionRequest struct {
	ResultID string `json:"result_id"`
}

type AcquisitionSettings struct {
	IndexerKind             string `json:"indexer_kind" tstype:"'prowlarr' | 'torznab'"`
	IndexerURL              string `json:"indexer_url"`
	HasIndexerAPIKey        bool   `json:"has_indexer_api_key"`
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
	QBitTorrentURL          string `json:"qbittorrent_url"`
	QBitTorrentUsername     string `json:"qbittorrent_username"`
	QBitTorrentPassword     string `json:"qbittorrent_password"`
	QBitTorrentCategory     string `json:"qbittorrent_category"`
	QBitTorrentDownloadRoot string `json:"qbittorrent_download_root"`
}

type AcquisitionConnectionStatus struct {
	ProwlarrOK       bool   `json:"prowlarr_ok"`
	IndexerCount     int    `json:"indexer_count"`
	ProwlarrError    string `json:"prowlarr_error,omitempty"`
	QBitTorrentOK    bool   `json:"qbittorrent_ok"`
	QBitTorrentError string `json:"qbittorrent_error,omitempty"`
}

type AcquisitionCapabilities struct {
	Enabled bool `json:"enabled"`
}
