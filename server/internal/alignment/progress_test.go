package alignment

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProgressIsAdvisoryAndOnlyExposedWhileProcessing(t *testing.T) {
	m := &Manager{options: Options{ArtifactRoot: t.TempDir()}}
	job := Job{ID: "test-job", State: "processing"}
	if got := m.withStage(job); got.Stage != "" {
		t.Fatal("missing telemetry must not invent progress")
	}

	m.writeStage(job.ID, "transcribing")
	if got := m.withStage(job); got.Stage != "transcribing" {
		t.Fatalf("stage = %q", got.Stage)
	}
	job.State = "ready"
	if got := m.withStage(job); got.Stage != "" {
		t.Fatal("terminal job exposed old progress")
	}
	job.State = "processing"
	for _, data := range []string{`{"stage":"untrusted text"}`, `{"stage":`, `{"stage":42}`} {
		if err := os.WriteFile(filepath.Join(m.options.ArtifactRoot, job.ID, "progress.json"), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := m.withStage(job); got.Stage != "" {
			t.Fatalf("invalid telemetry exposed: %q", got.Stage)
		}
	}

	m.writeStage(job.ID, "preparing")
	if got := m.withStage(job); got.Stage != "preparing" {
		t.Fatal("new attempt did not reset progress")
	}
}
