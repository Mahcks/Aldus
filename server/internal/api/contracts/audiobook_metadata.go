package contracts

type AudiobookRecordingDetails struct {
	Publisher      string `json:"publisher"`
	Language       string `json:"language"`
	ReleaseDate    string `json:"release_date"`
	RuntimeMinutes int    `json:"runtime_minutes"`
	Format         string `json:"format"`
}

type AudiobookMetadataValues struct {
	Narrators   []string `json:"narrators"`
	Description string   `json:"description"`
}

type AudiobookMetadataPreview struct {
	Recording      AudiobookRecordingDetails `json:"recording"`
	ASIN           string                    `json:"asin"`
	Region         string                    `json:"region"`
	Title          string                    `json:"title"`
	Authors        []string                  `json:"authors"`
	RuntimeMinutes int                       `json:"runtime_minutes"`
	Format         string                    `json:"format"`
	Current        AudiobookMetadataValues   `json:"current"`
	Values         AudiobookMetadataValues   `json:"values"`
}

type AudiobookMetadataCorrection struct {
	Recording AudiobookRecordingDetails `json:"recording"`
	ASIN      string                    `json:"asin"`
	Region    string                    `json:"region"`
	Fields    []string                  `json:"fields"`
	Expected  AudiobookMetadataValues   `json:"expected"`
	Values    AudiobookMetadataValues   `json:"values"`
}
