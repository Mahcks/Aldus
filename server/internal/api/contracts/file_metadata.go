package contracts

type FileMetadataValues struct {
	Values         MetadataValues `json:"values"`
	Series         string         `json:"series"`
	SeriesPosition string         `json:"series_position"`
	Narrators      []string       `json:"narrators"`
}
type FileMetadataPreview struct {
	ASIN      string             `json:"asin"`
	Current   FileMetadataValues `json:"current"`
	Suggested FileMetadataValues `json:"suggested"`
}
type ApplyFileMetadataRequest struct {
	Fields   []string           `json:"fields"`
	Expected FileMetadataValues `json:"expected"`
	Values   FileMetadataValues `json:"values"`
}
