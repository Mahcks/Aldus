package contracts

import "time"

type AcquisitionPolicy struct {
	LibraryID                  string    `json:"library_id"`
	DefaultEbookSourceID       string    `json:"default_ebook_source_id,omitempty"`
	DefaultAudiobookSourceID   string    `json:"default_audiobook_source_id,omitempty"`
	MaxEbookBytes              int64     `json:"max_ebook_bytes"`
	MaxAudiobookBytes          int64     `json:"max_audiobook_bytes"`
	AllowedEbookExtensions     []string  `json:"allowed_ebook_extensions"`
	AllowedAudiobookExtensions []string  `json:"allowed_audiobook_extensions"`
	PreferredLanguage          string    `json:"preferred_language"`
	AllowAbridged              bool      `json:"allow_abridged"`
	MaxActiveRequests          int       `json:"max_active_requests"`
	UpdatedAt                  time.Time `json:"updated_at,omitempty"`
}

type UpdateAcquisitionPolicyRequest struct {
	DefaultEbookSourceID       string   `json:"default_ebook_source_id"`
	DefaultAudiobookSourceID   string   `json:"default_audiobook_source_id"`
	MaxEbookBytes              int64    `json:"max_ebook_bytes"`
	MaxAudiobookBytes          int64    `json:"max_audiobook_bytes"`
	AllowedEbookExtensions     []string `json:"allowed_ebook_extensions"`
	AllowedAudiobookExtensions []string `json:"allowed_audiobook_extensions"`
	PreferredLanguage          string   `json:"preferred_language"`
	AllowAbridged              bool     `json:"allow_abridged"`
	MaxActiveRequests          int      `json:"max_active_requests"`
}
