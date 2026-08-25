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
	Token       string       `json:"token,omitempty"`
	ExpiresAt   time.Time    `json:"expires_at"`
	User        User         `json:"user"`
	DemoPairing *DemoPairing `json:"demo_pairing,omitempty"`
	// DemoCredentials keeps already-installed clients working during the pairing-code rollout.
	DemoCredentials *DemoCredentials `json:"demo_credentials,omitempty"`
}
type DemoPairing struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}
type DemoPairingRequest struct {
	Code string `json:"code"`
}
type DemoCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
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
