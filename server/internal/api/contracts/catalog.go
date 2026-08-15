package contracts

import "time"

type Library struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type Membership struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}
type Work struct {
	ID        string    `json:"id"`
	LibraryID string    `json:"library_id"`
	Title     string    `json:"title"`
	Author    string    `json:"author,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type WorkDetail struct {
	Work              `tstype:",extends,required"`
	InProgress        bool      `json:"in_progress"`
	ProgressUpdatedAt time.Time `json:"progress_updated_at,omitempty"`
	CompletionPercent int       `json:"completion_percent"`
	ActiveSeconds     int       `json:"active_seconds"`
	ReadingSeconds    int       `json:"reading_seconds"`
	ListeningSeconds  int       `json:"listening_seconds"`
	LastMode          string    `json:"last_mode,omitempty" tstype:"'read' | 'listen' | ''"`
}
type WorkSummary struct {
	ID                string    `json:"id"`
	LibraryID         string    `json:"library_id"`
	LibraryName       string    `json:"library_name"`
	LibraryRole       string    `json:"library_role,omitempty"`
	Title             string    `json:"title"`
	Author            string    `json:"author,omitempty"`
	Readable          bool      `json:"readable"`
	Listenable        bool      `json:"listenable"`
	Synchronized      bool      `json:"synchronized"`
	InProgress        bool      `json:"in_progress"`
	ProgressUpdatedAt time.Time `json:"progress_updated_at,omitempty"`
	CompletionPercent int       `json:"completion_percent"`
	ActiveSeconds     int       `json:"active_seconds"`
	ReadingSeconds    int       `json:"reading_seconds"`
	ListeningSeconds  int       `json:"listening_seconds"`
	LastMode          string    `json:"last_mode,omitempty" tstype:"'read' | 'listen' | ''"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}
type WorkBrowsePage struct {
	Items   []WorkSummary `json:"items"`
	Offset  int           `json:"offset"`
	HasMore bool          `json:"has_more"`
}
type Representation struct {
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
	Role string `json:"role"`
}
type CreateWorkRequest struct {
	Title  string `json:"title"`
	Author string `json:"author"`
}
type UpdateWorkRequest struct {
	Title  string `json:"title"`
	Author string `json:"author"`
}
type CreateRepresentationRequest struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}
type UpdateRepresentationRequest struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}
