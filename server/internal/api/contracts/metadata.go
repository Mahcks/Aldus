package contracts

type MetadataValues struct {
	Title            string   `json:"title"`
	Author           string   `json:"author"`
	Description      string   `json:"description"`
	ISBN             string   `json:"isbn"`
	Publisher        string   `json:"publisher"`
	Language         string   `json:"language"`
	FirstPublishYear int      `json:"first_publish_year"`
	Subjects         []string `json:"subjects"`
	CoverURL         string   `json:"cover_url"`
}

type MetadataCandidate struct {
	WorkID    string         `json:"work_id"`
	EditionID string         `json:"edition_id"`
	Values    MetadataValues `json:"values"`
}
type MetadataPreview struct {
	Current    MetadataValues      `json:"current"`
	Candidates []MetadataCandidate `json:"candidates"`
}
type ApplyMetadataRequest struct {
	WorkID    string         `json:"work_id"`
	EditionID string         `json:"edition_id"`
	Fields    []string       `json:"fields"`
	Expected  MetadataValues `json:"expected"`
	Values    MetadataValues `json:"values"`
}
