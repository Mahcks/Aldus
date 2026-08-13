package position

import (
	"errors"

	"github.com/mahcks/aldus/server/internal/api/contracts"
)

const OffsetMax = 1_000_000

var (
	ErrConflict = errors.New("progress revision conflict")
	ErrInvalid  = errors.New("invalid position")
	ErrNotFound = errors.New("position not found")
)

type Canonical = contracts.CanonicalPosition
type RepresentationState = contracts.RepresentationState
type RepresentationUpdate = contracts.RepresentationStateUpdate
type EPUBLocator = contracts.EPUBLocator
type AudioLocator = contracts.AudioLocator
type Update = contracts.ProgressUpdate
type Alignment = contracts.Alignment
type Segment = contracts.AlignmentSegment

type KOReaderLocator struct {
	DocumentID string  `json:"document"`
	Progress   string  `json:"progress"`
	Percentage float64 `json:"percentage,omitempty"`
}
