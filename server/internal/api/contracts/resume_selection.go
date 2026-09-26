package contracts

// EPUBSelectionRange is presentation metadata, never a canonical position.
type EPUBSelectionRange struct {
	Href   string `json:"href"`
	Text   string `json:"text"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// EPUBResumeSelection travels inside the existing opaque saved EPUB locator.
// Progress binds aligned selections to one acknowledged revision.
type EPUBResumeSelection struct {
	Version  int                `json:"version"`
	MediaID  string             `json:"media_id"`
	SHA256   string             `json:"sha256"`
	Range    EPUBSelectionRange `json:"range"`
	Progress *CanonicalPosition `json:"progress,omitempty"`
}
