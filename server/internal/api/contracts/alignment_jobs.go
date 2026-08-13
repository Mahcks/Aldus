package contracts

import "time"

type CreateAlignmentJobRequest struct {
	EPUBMediaID  string `json:"epub_media_id"`
	EPUBSHA256   string `json:"epub_sha256"`
	AudioMediaID string `json:"audio_media_id"`
	AudioSHA256  string `json:"audio_sha256"`
}
type AlignmentJob struct {
	ID            string     `json:"id"`
	AlignmentID   string     `json:"alignment_id,omitempty"`
	EPUBMediaID   string     `json:"epub_media_id"`
	AudioMediaID  string     `json:"audio_media_id"`
	State         string     `json:"state"`
	Attempts      int        `json:"attempts"`
	WorkerVersion string     `json:"worker_version"`
	Model         string     `json:"model"`
	ArtifactID    string     `json:"artifact_id,omitempty"`
	Error         string     `json:"error,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
}
