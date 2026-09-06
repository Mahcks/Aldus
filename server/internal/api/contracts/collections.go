package contracts

import "time"

type Collection struct {
	SharedLibraryID   string           `json:"shared_library_id,omitempty"`
	SharedLibraryName string           `json:"shared_library_name,omitempty"`
	OwnerName         string           `json:"owner_name,omitempty"`
	CanEdit           bool             `json:"can_edit,omitempty"`
	ID                string           `json:"id"`
	Title             string           `json:"title"`
	Description       string           `json:"description,omitempty"`
	WorkCount         int              `json:"work_count"`
	Works             []CollectionWork `json:"works,omitempty"`
	CreatedAt         time.Time        `json:"created_at"`
	UpdatedAt         time.Time        `json:"updated_at"`
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

type ShareCollectionRequest struct {
	LibraryID string `json:"library_id"`
}
