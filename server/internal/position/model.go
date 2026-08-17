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
	WorkID         string    `json:"work_id,omitempty"`
	AlignmentID    string    `json:"alignment_id"`
	SegmentID      string    `json:"segment_id"`
	Offset         int       `json:"offset"`
	Revision       int64     `json:"revision,omitempty"`
	UpdatedAt      time.Time `json:"updated_at,omitempty"`
	SourceDevice   string    `json:"source_device,omitempty"`
	AlignmentState string    `json:"alignment_state,omitempty"`
	Resolvable     *bool     `json:"resolvable,omitempty"`
}
type RepresentationState struct {
	RepresentationID string          `json:"representation_id"`
	EPUBLocator      json.RawMessage `json:"epub_locator,omitempty"`
	AudioTimestampMS *int64          `json:"audio_timestamp_ms,omitempty"`
	PlaybackSpeed    *float64        `json:"playback_speed,omitempty"`
	ReaderLayout     string          `json:"reader_layout,omitempty"`
	Zoom             *float64        `json:"zoom,omitempty"`
	ReaderTheme      string          `json:"reader_theme,omitempty"`
	LineHeight       *float64        `json:"line_height,omitempty"`
	Margin           *float64        `json:"margin,omitempty"`
	Revision         int64           `json:"revision"`
	UpdatedAt        time.Time       `json:"updated_at"`
}
type RepresentationUpdate struct {
	EPUBLocator      json.RawMessage `json:"epub_locator,omitempty"`
	AudioTimestampMS *int64          `json:"audio_timestamp_ms,omitempty"`
	PlaybackSpeed    *float64        `json:"playback_speed,omitempty"`
	ReaderLayout     string          `json:"reader_layout,omitempty"`
	Zoom             *float64        `json:"zoom,omitempty"`
	ReaderTheme      string          `json:"reader_theme,omitempty"`
	LineHeight       *float64        `json:"line_height,omitempty"`
	Margin           *float64        `json:"margin,omitempty"`
	ExpectedRevision int64           `json:"expected_revision"`
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
	Highlightable   bool            `json:"highlightable"`
	AlignmentStatus string          `json:"alignment_status"`
	WordTimings     json.RawMessage `json:"word_timings,omitempty"`
}

type KOReaderLocator struct {
	DocumentID string  `json:"document"`
	Progress   string  `json:"progress"`
	Percentage float64 `json:"percentage,omitempty"`
}
