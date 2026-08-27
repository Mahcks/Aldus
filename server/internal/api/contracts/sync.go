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
	ReaderTheme      string          `json:"reader_theme,omitempty" tstype:"'paper' | 'sepia' | 'night'"`
	LineHeight       *float64        `json:"line_height,omitempty"`
	Margin           *float64        `json:"margin,omitempty"`
	Revision         int64           `json:"revision"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type RepresentationStateUpdate struct {
	EPUBLocator      json.RawMessage `json:"epub_locator,omitempty"`
	AudioTimestampMS *int64          `json:"audio_timestamp_ms,omitempty"`
	PlaybackSpeed    *float64        `json:"playback_speed,omitempty"`
	ReaderLayout     string          `json:"reader_layout,omitempty" tstype:"'paginated' | 'scrolled'"`
	Zoom             *float64        `json:"zoom,omitempty"`
	ReaderTheme      string          `json:"reader_theme,omitempty" tstype:"'paper' | 'sepia' | 'night'"`
	LineHeight       *float64        `json:"line_height,omitempty"`
	Margin           *float64        `json:"margin,omitempty"`
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

type WorkPreference struct {
	WorkID       string    `json:"work_id"`
	EPUBMediaID  string    `json:"epub_media_id"`
	AudioMediaID string    `json:"audio_media_id"`
	AlignmentID  string    `json:"alignment_id"`
	UpdatedAt    time.Time `json:"updated_at,omitempty"`
}

type SetWorkPreferenceRequest struct {
	EPUBMediaID  string `json:"epub_media_id"`
	AudioMediaID string `json:"audio_media_id"`
	AlignmentID  string `json:"alignment_id"`
}

type ActivitySession struct {
	ID            string     `json:"id"`
	WorkID        string     `json:"work_id"`
	Mode          string     `json:"mode" tstype:"'read' | 'listen'"`
	StartedAt     time.Time  `json:"started_at"`
	LastSeenAt    time.Time  `json:"last_seen_at"`
	EndedAt       *time.Time `json:"ended_at,omitempty"`
	ActiveSeconds int        `json:"active_seconds"`
}

type StartActivityRequest struct {
	Mode string `json:"mode" tstype:"'read' | 'listen'"`
}

type UpdateActivityRequest struct {
	ActiveSeconds int  `json:"active_seconds"`
	Ended         bool `json:"ended"`
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
	Highlightable   bool            `json:"highlightable"`
	AlignmentStatus string          `json:"alignment_status"`
	WordTimings     json.RawMessage `json:"word_timings,omitempty"`
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
