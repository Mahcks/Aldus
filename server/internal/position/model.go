package position

import (
	"encoding/json"
	"errors"
	"time"
)

const OffsetMax = 1_000_000

var (
	ErrConflict = errors.New("progress revision conflict")
	ErrInvalid  = errors.New("invalid position")
	ErrNotFound = errors.New("position not found")
)

type Canonical struct {
	AlignmentID  string    `json:"alignment_id"`
	SegmentID    string    `json:"segment_id"`
	Offset       int       `json:"offset"`
	Revision     int64     `json:"revision,omitempty"`
	UpdatedAt    time.Time `json:"updated_at,omitempty"`
	SourceDevice string    `json:"source_device,omitempty"`
}

type EPUBLocator struct {
	Href    string          `json:"href"`
	Locator json.RawMessage `json:"locator"`
	Offset  int             `json:"offset"`
}

type AudioLocator struct {
	Resource    string `json:"resource"`
	TimestampMS int64  `json:"timestamp_ms"`
}

type KOReaderLocator struct {
	DocumentID string  `json:"document"`
	Progress   string  `json:"progress"`
	Percentage float64 `json:"percentage,omitempty"`
}

type Update struct {
	SegmentID        string `json:"segment_id"`
	Offset           int    `json:"offset"`
	ExpectedRevision int64  `json:"expected_revision"`
	SourceDevice     string `json:"source_device"`
}

type Alignment struct {
	ID          string    `json:"id"`
	Revision    int       `json:"revision"`
	State       string    `json:"state"`
	EPUBSHA256  string    `json:"epub_sha256"`
	AudioSHA256 string    `json:"audio_sha256"`
	Segments    []Segment `json:"segments"`
}

type Segment struct {
	ID              string          `json:"id"`
	Ordinal         int             `json:"ordinal"`
	Text            string          `json:"text"`
	EPUBHref        string          `json:"epub_href"`
	EPUBLocator     json.RawMessage `json:"epub_locator"`
	KOReaderLocator string          `json:"koreader_locator"`
	AudioResource   string          `json:"audio_resource"`
	AudioStartMS    int64           `json:"audio_start_ms"`
	AudioEndMS      int64           `json:"audio_end_ms"`
}
