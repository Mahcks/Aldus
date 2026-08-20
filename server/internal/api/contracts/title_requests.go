package contracts

import "time"

type TitleRequest struct {
	ID             string               `json:"id"`
	LibraryID      string               `json:"library_id"`
	RequestedBy    string               `json:"requested_by"`
	WorkID         string               `json:"work_id,omitempty"`
	ExternalSource string               `json:"external_source,omitempty"`
	ExternalID     string               `json:"external_id,omitempty"`
	Title          string               `json:"title"`
	Author         string               `json:"author,omitempty"`
	CoverURL       string               `json:"cover_url,omitempty"`
	Formats        []TitleRequestFormat `json:"formats"`
	CreatedAt      time.Time            `json:"created_at"`
	UpdatedAt      time.Time            `json:"updated_at"`
}

type TitleRequestFormat struct {
	Format         string    `json:"format"`
	State          string    `json:"state"`
	Error          string    `json:"error,omitempty"`
	RetryCount     int       `json:"retry_count"`
	LastSearchedAt time.Time `json:"last_searched_at,omitempty"`
	NextSearchAt   time.Time `json:"next_search_at,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type TitleRequestEvent struct {
	Format    string    `json:"format,omitempty"`
	EventType string    `json:"event_type"`
	State     string    `json:"state,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateTitleRequest struct {
	WorkID         string   `json:"work_id"`
	ExternalSource string   `json:"external_source"`
	ExternalID     string   `json:"external_id"`
	Title          string   `json:"title"`
	Author         string   `json:"author"`
	CoverURL       string   `json:"cover_url"`
	Formats        []string `json:"formats"`
}
