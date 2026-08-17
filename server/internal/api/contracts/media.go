package contracts

import "time"

type Media struct {
	ID               string    `json:"id"`
	RepresentationID string    `json:"representation_id"`
	Kind             string    `json:"kind"`
	SHA256           string    `json:"sha256"`
	OriginalFilename string    `json:"original_filename,omitempty"`
	SizeBytes        int64     `json:"size_bytes"`
	CreatedAt        time.Time `json:"created_at"`
}

type AudioChapter struct {
	Title   string `json:"title"`
	StartMS int64  `json:"start_ms"`
	EndMS   int64  `json:"end_ms"`
}
