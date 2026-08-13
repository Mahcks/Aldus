package contracts

import "time"

type LibrarySource struct {
	ID        string    `json:"id"`
	LibraryID string    `json:"library_id"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	RootPath  string    `json:"root_path"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type CreateLibrarySourceRequest struct {
	Name     string `json:"name"`
	RootPath string `json:"root_path"`
}
type UpdateLibrarySourceRequest struct {
	Name     string `json:"name"`
	RootPath string `json:"root_path"`
	Enabled  bool   `json:"enabled"`
}
