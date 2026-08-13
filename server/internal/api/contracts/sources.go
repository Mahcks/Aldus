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
type SourceScan struct {
	ID           string     `json:"id"`
	SourceID     string     `json:"source_id"`
	State        string     `json:"state"`
	Error        string     `json:"error,omitempty"`
	FilesVisited int        `json:"files_visited"`
	Supported    int        `json:"supported"`
	EPUB         int        `json:"epub"`
	Audio        int        `json:"audio"`
	New          int        `json:"new"`
	Changed      int        `json:"changed"`
	Unchanged    int        `json:"unchanged"`
	Missing      int        `json:"missing"`
	Problems     int        `json:"problems"`
	CreatedAt    time.Time  `json:"created_at"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}
type SourceEntry struct {
	ID           string         `json:"id"`
	SourceID     string         `json:"source_id"`
	RelativePath string         `json:"relative_path"`
	Kind         string         `json:"kind"`
	SHA256       string         `json:"sha256,omitempty"`
	State        string         `json:"state"`
	Error        string         `json:"error,omitempty"`
	SizeBytes    int64          `json:"size_bytes"`
	ModifiedAt   time.Time      `json:"modified_at"`
	Metadata     map[string]any `json:"metadata"`
	PathHints    map[string]any `json:"path_hints"`
}
