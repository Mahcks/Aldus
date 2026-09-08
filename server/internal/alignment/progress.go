package alignment

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
)

// Progress is advisory telemetry, separate from validated alignment artifacts.
// Only the active attempt is exposed; terminal jobs never display stale stages.
func (m *Manager) withStage(job Job) Job {
	if job.State != "processing" {
		return job
	}

	file, err := os.Open(filepath.Join(m.options.ArtifactRoot, job.ID, "progress.json"))
	if err != nil {
		return job
	}
	defer file.Close()

	var progress struct {
		Stage string `json:"stage"`
	}
	if json.NewDecoder(io.LimitReader(file, 1024)).Decode(&progress) != nil {
		return job
	}

	switch progress.Stage {
	case "preparing", "loading_audio", "loading_model", "transcribing",
		"loading_alignment_model", "aligning_words", "matching_text", "validating":
		job.Stage = progress.Stage
	}
	return job
}

func (m *Manager) writeStage(id, stage string) {
	dir := filepath.Join(m.options.ArtifactRoot, id)
	if os.MkdirAll(dir, 0o750) != nil {
		return
	}

	data, err := json.Marshal(map[string]string{"stage": stage})
	if err != nil {
		return
	}
	// The worker has not started, or has exited, when the manager writes a stage.
	temporary := filepath.Join(dir, "progress.json.tmp")
	if os.WriteFile(temporary, data, 0o600) == nil {
		_ = os.Rename(temporary, filepath.Join(dir, "progress.json"))
	}
}
