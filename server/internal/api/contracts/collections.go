package contracts

import "time"

type Collection struct {
	ID          string           `json:"id"`
	Title       string           `json:"title"`
	Description string           `json:"description,omitempty"`
	WorkCount   int              `json:"work_count"`
	Works       []CollectionWork `json:"works,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type CollectionWork struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Author   string `json:"author,omitempty"`
	CoverURL string `json:"cover_url,omitempty"`
	Position int    `json:"position"`
}

type CollectionInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type AddCollectionWorkRequest struct {
	WorkID string `json:"work_id"`
}

type ReorderCollectionWorksRequest struct {
	WorkIDs []string `json:"work_ids"`
}
