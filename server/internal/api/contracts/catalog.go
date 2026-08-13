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
