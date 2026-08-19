package contracts

import "time"

type SourceRoot struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Path      string `json:"path"`
	Available bool   `json:"available"`
}
type SourceDirectoryListing struct {
	RootID       string   `json:"root_id"`
	RelativePath string   `json:"relative_path"`
	SelectedPath string   `json:"selected_path"`
	HasParent    bool     `json:"has_parent"`
	Directories  []string `json:"directories"`
}

type LibrarySource struct {
	ID          string    `json:"id"`
	LibraryID   string    `json:"library_id"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	RootPath    string    `json:"root_path"`
	StorageKind string    `json:"storage_kind"`
	Enabled     bool      `json:"enabled"`
	AutoImport  bool      `json:"auto_import"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type CreateLibrarySourceRequest struct {
	Name       string `json:"name"`
	RootPath   string `json:"root_path"`
	AutoImport bool   `json:"auto_import"`
}
type UpdateLibrarySourceRequest struct {
	Name       string `json:"name"`
	RootPath   string `json:"root_path"`
	Enabled    bool   `json:"enabled"`
	AutoImport bool   `json:"auto_import"`
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
	AutoImported int        `json:"auto_imported"`
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
type ImportProposal struct {
	ID               string               `json:"id"`
	LibraryID        string               `json:"library_id"`
	State            string               `json:"state"`
	Confidence       string               `json:"confidence"`
	Title            string               `json:"title"`
	Author           string               `json:"author"`
	NormalizedTitle  string               `json:"normalized_title"`
	NormalizedAuthor string               `json:"normalized_author"`
	ExistingWorkID   string               `json:"existing_work_id,omitempty"`
	Reasons          []string             `json:"reasons"`
	Revision         int                  `json:"revision"`
	Items            []ImportProposalItem `json:"items"`
	CreatedAt        time.Time            `json:"created_at"`
	UpdatedAt        time.Time            `json:"updated_at"`
}
type ImportProposalItem struct {
	SourceEntryID string         `json:"source_entry_id"`
	RelativePath  string         `json:"relative_path"`
	Kind          string         `json:"kind"`
	Label         string         `json:"label"`
	SHA256        string         `json:"sha256"`
	Duplicate     bool           `json:"duplicate"`
	Evidence      map[string]any `json:"evidence"`
}
type AcceptImportProposalRequest struct {
	ExpectedRevision int                `json:"expected_revision"`
	WorkID           string             `json:"work_id,omitempty"`
	Title            string             `json:"title"`
	Author           string             `json:"author"`
	Items            []AcceptImportItem `json:"items"`
}
type AcceptImportItem struct {
	SourceEntryID    string `json:"source_entry_id"`
	RepresentationID string `json:"representation_id,omitempty"`
	Kind             string `json:"kind"`
	Label            string `json:"label"`
}
type AcceptImportProposalResponse struct {
	WorkID string `json:"work_id"`
}
type IgnoreImportProposalRequest struct {
	ExpectedRevision int `json:"expected_revision"`
}
