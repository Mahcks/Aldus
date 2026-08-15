package contracts

import "time"

type ReaderCredential struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Secret     string     `json:"secret,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type CreateReaderCredentialRequest struct {
	Label string `json:"label"`
}
