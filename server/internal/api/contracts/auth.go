package contracts

import "time"

type User struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Admin       bool      `json:"admin"`
	Disabled    bool      `json:"disabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
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
type BootstrapRequest struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	DisplayName    string `json:"display_name,omitempty"`
	BootstrapToken string `json:"bootstrap_token"`
}
type SetupStatus struct {
	Available bool `json:"available"`
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
