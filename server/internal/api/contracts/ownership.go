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
}

type ReadingOwnershipConflict struct {
	Code  string        `json:"code" tstype:"'ownership_superseded'"`
	Owner *ReadingOwner `json:"owner" tstype:"ReadingOwner | null"`
}
