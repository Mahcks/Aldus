package contracts

import "time"

type Library struct {
	ID                            string    `json:"id"`
	Name                          string    `json:"name"`
	Role                          string    `json:"role,omitempty"`
	Exclusive                     bool      `json:"exclusive"`
	Effective                     bool      `json:"effective"`
	CanRequestAcquisitions        bool      `json:"can_request_acquisitions"`
	CanBypassAcquisitionApproval  bool      `json:"can_bypass_acquisition_approval"`
	CanAdvancedAcquisitionRequest bool      `json:"can_advanced_acquisition_request"`
	CreatedAt                     time.Time `json:"created_at"`
	UpdatedAt                     time.Time `json:"updated_at"`
}
type Membership struct {
	UserID                        string `json:"user_id"`
	Username                      string `json:"username"`
	DisplayName                   string `json:"display_name"`
	Role                          string `json:"role"`
	Exclusive                     bool   `json:"exclusive"`
	CanRequestAcquisitions        bool   `json:"can_request_acquisitions"`
	CanBypassAcquisitionApproval  bool   `json:"can_bypass_acquisition_approval"`
	CanAdvancedAcquisitionRequest bool   `json:"can_advanced_acquisition_request"`
}
type Work struct {
	Series               string    `json:"series,omitempty"`
	SeriesPosition       string    `json:"series_position,omitempty"`
	ID                   string    `json:"id"`
	LibraryID            string    `json:"library_id"`
	Title                string    `json:"title"`
	Author               string    `json:"author,omitempty"`
	CoverURL             string    `json:"cover_url,omitempty"`
	CoverFit             string    `json:"cover_fit" tstype:"'cover' | 'contain'"`
	CoverFocalX          int       `json:"cover_focal_x"`
	CoverFocalY          int       `json:"cover_focal_y"`
	GeneratedCoverStyle  string    `json:"generated_cover_style" tstype:"'classic' | 'minimal' | 'framed'"`
	GeneratedCoverTone   int       `json:"generated_cover_tone"`
	GeneratedCoverLayout string    `json:"generated_cover_layout" tstype:"'top' | 'center' | 'bottom'"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}
type WorkDetail struct {
	NextInSeries      *Work `json:"next_in_series,omitempty"`
	Work              `tstype:",extends,required"`
	Description       string     `json:"description,omitempty"`
	ISBN              string     `json:"isbn,omitempty"`
	FirstPublishYear  int        `json:"first_publish_year,omitempty"`
	Publisher         string     `json:"publisher,omitempty"`
	Language          string     `json:"language,omitempty"`
	Subjects          string     `json:"subjects,omitempty"`
	SubjectValues     []string   `json:"subject_values"`
	GenreTags         []GenreTag `json:"genre_tags"`
	GenreTagsManual   bool       `json:"genre_tags_manual"`
	InProgress        bool       `json:"in_progress"`
	ProgressUpdatedAt time.Time  `json:"progress_updated_at,omitempty"`
	CompletionPercent int        `json:"completion_percent"`
	ActiveSeconds     int        `json:"active_seconds"`
	ReadingSeconds    int        `json:"reading_seconds"`
	ListeningSeconds  int        `json:"listening_seconds"`
	LastMode          string     `json:"last_mode,omitempty" tstype:"'read' | 'listen' | ''"`
	ReadingStatus     string     `json:"reading_status" tstype:"'want_to_read' | 'reading' | 'finished' | ''"`
}
type GenreTag struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Icon     string   `json:"icon"`
	Keywords []string `json:"keywords,omitempty"`
}
type UnmatchedGenreSubject struct {
	Subject   string `json:"subject"`
	WorkCount int    `json:"work_count"`
}
type UnmatchedGenreSubjectPage struct {
	Items   []UnmatchedGenreSubject `json:"items"`
	Offset  int                     `json:"offset"`
	HasMore bool                    `json:"has_more"`
}
type WorkSummary struct {
	Series               string    `json:"series,omitempty"`
	SeriesPosition       string    `json:"series_position,omitempty"`
	ID                   string    `json:"id"`
	LibraryID            string    `json:"library_id"`
	LibraryName          string    `json:"library_name"`
	Title                string    `json:"title"`
	Author               string    `json:"author,omitempty"`
	CoverURL             string    `json:"cover_url,omitempty"`
	CoverFit             string    `json:"cover_fit" tstype:"'cover' | 'contain'"`
	CoverFocalX          int       `json:"cover_focal_x"`
	CoverFocalY          int       `json:"cover_focal_y"`
	GeneratedCoverStyle  string    `json:"generated_cover_style" tstype:"'classic' | 'minimal' | 'framed'"`
	GeneratedCoverTone   int       `json:"generated_cover_tone"`
	GeneratedCoverLayout string    `json:"generated_cover_layout" tstype:"'top' | 'center' | 'bottom'"`
	Readable             bool      `json:"readable"`
	Listenable           bool      `json:"listenable"`
	Synchronized         bool      `json:"synchronized"`
	InProgress           bool      `json:"in_progress"`
	ProgressUpdatedAt    time.Time `json:"progress_updated_at,omitempty"`
	CompletionPercent    int       `json:"completion_percent"`
	ActiveSeconds        int       `json:"active_seconds"`
	ReadingSeconds       int       `json:"reading_seconds"`
	ListeningSeconds     int       `json:"listening_seconds"`
	LastMode             string    `json:"last_mode,omitempty" tstype:"'read' | 'listen' | ''"`
	ReadingStatus        string    `json:"reading_status" tstype:"'want_to_read' | 'reading' | 'finished' | ''"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}
type WorkBrowsePage struct {
	Items   []WorkSummary `json:"items"`
	Offset  int           `json:"offset"`
	HasMore bool          `json:"has_more"`
}
type Representation struct {
	Narrators []string  `json:"narrators,omitempty"`
	ID        string    `json:"id"`
	WorkID    string    `json:"work_id"`
	Kind      string    `json:"kind"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type CreateLibraryRequest struct {
	Name string `json:"name"`
}
type UpdateLibraryRequest struct {
	Name string `json:"name"`
}
type SetMembershipRequest struct {
	Role                          string `json:"role"`
	Exclusive                     bool   `json:"exclusive"`
	CanRequestAcquisitions        bool   `json:"can_request_acquisitions"`
	CanBypassAcquisitionApproval  bool   `json:"can_bypass_acquisition_approval"`
	CanAdvancedAcquisitionRequest bool   `json:"can_advanced_acquisition_request"`
}
type CreateWorkRequest struct {
	Title  string `json:"title"`
	Author string `json:"author"`
}
type UpdateWorkRequest struct {
	Series           *string   `json:"series,omitempty"`
	SeriesPosition   *string   `json:"series_position,omitempty"`
	Title            string    `json:"title"`
	Author           string    `json:"author"`
	Description      *string   `json:"description,omitempty"`
	ISBN             *string   `json:"isbn,omitempty"`
	FirstPublishYear *int      `json:"first_publish_year,omitempty"`
	Publisher        *string   `json:"publisher,omitempty"`
	Language         *string   `json:"language,omitempty"`
	Subjects         *[]string `json:"subjects,omitempty"`
}
type CreateGenreTagRequest struct {
	Label    string   `json:"label"`
	Icon     string   `json:"icon"`
	Keywords []string `json:"keywords"`
}
type UpdateGenreTagRequest struct {
	Label    string   `json:"label"`
	Icon     string   `json:"icon"`
	Keywords []string `json:"keywords"`
}
type SetWorkGenreTagsRequest struct {
	GenreTagIDs []string `json:"genre_tag_ids"`
}
type SetWorkStatusRequest struct {
	Status string `json:"status" tstype:"'want_to_read' | 'reading' | 'finished' | ''"`
}
type CoverCandidate struct {
	Source           string `json:"source" tstype:"'open_library' | 'embedded'"`
	SourceID         string `json:"source_id"`
	ImageURL         string `json:"image_url"`
	Title            string `json:"title"`
	Author           string `json:"author,omitempty"`
	Publisher        string `json:"publisher,omitempty"`
	ISBN             string `json:"isbn,omitempty"`
	FirstPublishYear int    `json:"first_publish_year,omitempty"`
}
type CoverAsset struct {
	ID        string    `json:"id,omitempty"`
	Source    string    `json:"source" tstype:"'open_library' | 'embedded' | 'upload'"`
	SourceID  string    `json:"source_id"`
	ImageURL  string    `json:"image_url"`
	Label     string    `json:"label"`
	Selected  bool      `json:"selected"`
	CreatedAt time.Time `json:"created_at,omitempty"`
}
type SelectCoverRequest struct {
	Source   string `json:"source"`
	SourceID string `json:"source_id"`
}
type UpdateCoverSettingsRequest struct {
	Fit    string `json:"fit"`
	FocalX int    `json:"focal_x"`
	FocalY int    `json:"focal_y"`
	Style  string `json:"style"`
	Tone   int    `json:"tone"`
	Layout string `json:"layout"`
}
type CreateRepresentationRequest struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}
type UpdateRepresentationRequest struct {
	Narrators *[]string `json:"narrators,omitempty"`
	Kind      string    `json:"kind"`
	Label     string    `json:"label"`
}

type CatalogGroup struct {
	Name        string `json:"name"`
	LibraryID   string `json:"library_id,omitempty"`
	LibraryName string `json:"library_name,omitempty"`
	WorkCount   int    `json:"work_count"`
}
type CatalogGroupPage struct {
	Items   []CatalogGroup `json:"items"`
	Offset  int            `json:"offset"`
	HasMore bool           `json:"has_more"`
}
