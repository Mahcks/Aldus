// Package contracts contains the intentionally public JSON contracts shared with clients.
package contracts

import (
	"encoding/json"
	"time"
)

type CanonicalPosition struct {
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
	ReaderLayout     string          `json:"reader_layout,omitempty" tstype:"'paginated' | 'scrolled'"`
	Zoom             *float64        `json:"zoom,omitempty"`
	Revision         int64           `json:"revision"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type RepresentationStateUpdate struct {
	EPUBLocator      json.RawMessage `json:"epub_locator,omitempty"`
	AudioTimestampMS *int64          `json:"audio_timestamp_ms,omitempty"`
	PlaybackSpeed    *float64        `json:"playback_speed,omitempty"`
	ReaderLayout     string          `json:"reader_layout,omitempty" tstype:"'paginated' | 'scrolled'"`
	Zoom             *float64        `json:"zoom,omitempty"`
	ExpectedRevision int64           `json:"expected_revision"`
}

type ProgressUpdate struct {
	SegmentID        string `json:"segment_id"`
	Offset           int    `json:"offset"`
	ExpectedRevision int64  `json:"expected_revision"`
	SourceDevice     string `json:"source_device"`
}

type WorkProgressUpdate struct {
	AlignmentID    string `json:"alignment_id"`
	ProgressUpdate `tstype:",extends,required"`
}

type Alignment struct {
	ID          string             `json:"id"`
	Revision    int                `json:"revision"`
	State       string             `json:"state"`
	EPUBSHA256  string             `json:"epub_sha256"`
	AudioSHA256 string             `json:"audio_sha256"`
	Segments    []AlignmentSegment `json:"segments"`
}

type AlignmentSegment struct {
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

type EPUBLocator struct {
	Href    string          `json:"href"`
	Locator json.RawMessage `json:"locator"`
	Offset  int             `json:"offset"`
}

type AudioLocator struct {
	Resource    string `json:"resource"`
	TimestampMS int64  `json:"timestamp_ms"`
}
