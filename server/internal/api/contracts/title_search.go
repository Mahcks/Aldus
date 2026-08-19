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
