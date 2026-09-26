package contracts

import "time"

type ReadingOwnershipProof struct {
	DeviceID string `json:"device_id"`
	Epoch    int64  `json:"epoch"`
}

type ReadingOwner struct {
	WorkID    string    `json:"work_id"`
	DeviceID  string    `json:"device_id"`
	Label     string    `json:"label"`
	Platform  string    `json:"platform" tstype:"'web' | 'ios' | 'android' | 'other'"`
	Epoch     int64     `json:"epoch"`
	UpdatedAt time.Time `json:"updated_at"`
	// IdleSeconds is measured on the server, so clients need not trust their own clock.
	IdleSeconds int64 `json:"idle_seconds"`
}

type ReadingOwnershipConflict struct {
	Code  string        `json:"code" tstype:"'ownership_superseded'"`
	Owner *ReadingOwner `json:"owner" tstype:"ReadingOwner | null"`
}

type ClaimReadingSessionRequest struct {
	DeviceID      string `json:"device_id"`
	Label         string `json:"label"`
	Platform      string `json:"platform" tstype:"'web' | 'ios' | 'android' | 'other'"`
	RequestID     string `json:"request_id"`
	ExpectedEpoch int64  `json:"expected_epoch"`
}

// ReadingClaim includes the exact saved places captured with the ownership change.
type ReadingClaim struct {
	Owner                ReadingOwner          `json:"owner"`
	Progress             *CanonicalPosition    `json:"progress" tstype:"CanonicalPosition | null"`
	RepresentationStates []RepresentationState `json:"representation_states"`
}
