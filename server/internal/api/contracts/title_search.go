package contracts

type TitleSearchResult struct {
	WorkID                string `json:"work_id,omitempty"`
	LibraryID             string `json:"library_id,omitempty"`
	Title                 string `json:"title"`
	Author                string `json:"author,omitempty"`
	CoverURL              string `json:"cover_url,omitempty"`
	ExternalSource        string `json:"external_source,omitempty"`
	ExternalID            string `json:"external_id,omitempty"`
	Readable              bool   `json:"readable"`
	Listenable            bool   `json:"listenable"`
	Synchronized          bool   `json:"synchronized"`
	EbookRequestState     string `json:"ebook_request_state,omitempty"`
	AudiobookRequestState string `json:"audiobook_request_state,omitempty"`
}

// TrendingSection groups trending titles from one source (Open Library or a
// single NYT Best Sellers list) for Discover's "not searching" browse view.
type TrendingSection struct {
	Source string              `json:"source"`
	Title  string              `json:"title"`
	Items  []TitleSearchResult `json:"items"`
}

// TrendingDetail is the on-demand "view more about this book" description
// for a not-yet-owned Discover result.
type TrendingDetail struct {
	Description string `json:"description"`
}
