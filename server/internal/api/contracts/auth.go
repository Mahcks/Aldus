package contracts

import "time"

type User struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	DisplayName   string     `json:"display_name"`
	Admin         bool       `json:"admin"`
	Disabled      bool       `json:"disabled"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	DemoExpiresAt *time.Time `json:"demo_expires_at,omitempty"`
}
type Session struct {
	Token     string    `json:"token,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
	User      User      `json:"user"`
}
type LoginRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name,omitempty"`
}
type SetupRequest struct {
	Username             string `json:"username"`
	Password             string `json:"password"`
	PasswordConfirmation string `json:"password_confirmation"`
	DisplayName          string `json:"display_name,omitempty"`
}
type SetupStatus struct {
	Available     bool `json:"available"`
	DemoAvailable bool `json:"demo_available"`
}
type CreateUserRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name,omitempty"`
	Admin       bool   `json:"admin"`
}
type UpdateUserRequest struct {
	Disabled *bool `json:"disabled"`
}
