package alignment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrHealthForbidden = errors.New("administrator access required")
var ErrRuntimeBusy = errors.New("alignment worker is busy; wait for the current job or test to finish")

// RuntimeHealth is a point-in-time preflight, not proof that a particular book aligns.
type RuntimeHealth struct {
	Accelerator      string          `json:"accelerator"`
	AcceleratorLabel string          `json:"acceleratorLabel"`
	DetectedGPU      string          `json:"detectedGpu"`
	GPUTest          GPUTestResult   `json:"gpuTest"`
	Alignment        ReadinessResult `json:"alignment"`
	LastCheckedAt    *time.Time      `json:"lastCheckedAt"`
}
type GPUTestResult struct {
	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
	Error  string `json:"error,omitempty"`
}
type ReadinessResult struct {
	Readiness string   `json:"readiness"`
	Issues    []string `json:"issues"`
}

func initialHealth() RuntimeHealth {
	accelerator := os.Getenv("ALDUS_ALIGNMENT_ACCELERATOR")
	if accelerator == "" {
		accelerator = "cpu"
	}
	label := "CPU"
	if accelerator == "cuda" {
		label = "CUDA"
	} else if accelerator != "cpu" {
		label = "Invalid accelerator configuration"
		accelerator = "unknown"
	}
	return RuntimeHealth{
		Accelerator:      accelerator,
		AcceleratorLabel: label,
		DetectedGPU:      "Not checked",
		GPUTest:          GPUTestResult{State: "not_checked"},
		Alignment:        ReadinessResult{Readiness: "unknown", Issues: []string{}},
	}
}

func (m *Manager) RuntimeHealth(actor auth.User) (RuntimeHealth, error) {
	if !actor.Admin {
		return RuntimeHealth{}, ErrHealthForbidden
	}
	m.healthMu.Lock()
	defer m.healthMu.Unlock()
	if m.health == nil {
		return initialHealth(), nil
	}
	result := *m.health
	result.Alignment.Issues = append([]string{}, result.Alignment.Issues...)
	return result, nil
}

func (m *Manager) TestRuntime(ctx context.Context, actor auth.User) (RuntimeHealth, error) {
	if !actor.Admin {
		return RuntimeHealth{}, ErrHealthForbidden
	}
	select {
	case m.runtimeSlot <- struct{}{}:
		defer func() { <-m.runtimeSlot }()
	default:
		return RuntimeHealth{}, ErrRuntimeBusy
	}
	result := initialHealth()
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	m.mu.Lock()
	m.cancel["runtime-health"] = cancel
	if m.stopped {
		cancel()
	}
	m.mu.Unlock()
	defer func() {
		cancel()
		m.mu.Lock()
		delete(m.cancel, "runtime-health")
		m.mu.Unlock()
	}()
	args := append(append([]string{}, m.options.Command[1:]...), "--diagnostics", "--model", m.options.Model)
	cmd := exec.CommandContext(ctx, m.options.Command[0], args...)
	cmd.WaitDelay = time.Second
	cmd.Env = append(os.Environ(),
		"HF_HOME="+m.options.ModelRoot,
		"TORCH_HOME="+filepath.Join(m.options.ModelRoot, "torch"),
		"NLTK_DATA="+filepath.Join(m.options.ModelRoot, "nltk"),
		"MPLCONFIGDIR="+filepath.Join(m.options.ArtifactRoot, "matplotlib"),
		"HF_HUB_OFFLINE=1", "TRANSFORMERS_OFFLINE=1",
	)
	var output bytes.Buffer
	bounded := &limitWriter{writer: &output, remaining: 32 << 10}
	cmd.Stdout = bounded
	cmd.Stderr = io.Discard
	err := cmd.Run()
	var checked RuntimeHealth
	if err == nil {
		err = json.Unmarshal(output.Bytes(), &checked)
	}
	if err == nil && !validHealth(checked, result.Accelerator) {
		err = errors.New("invalid diagnostic response")
	}
	if err != nil {
		message := "The configured alignment worker could not complete its diagnostic check. Verify the worker command and deploy an image with diagnostic support."
		if ctx.Err() != nil {
			message = "The diagnostic check was canceled or exceeded 90 seconds. Wait for the server to be idle and try again."
		}
		result.Alignment = ReadinessResult{Readiness: "not_ready", Issues: []string{message}}
	} else {
		result.DetectedGPU = checked.DetectedGPU
		result.GPUTest = checked.GPUTest
		result.Alignment = checked.Alignment
	}
	now := time.Now().UTC()
	result.LastCheckedAt = &now
	m.healthMu.Lock()
	cached := result
	cached.Alignment.Issues = append([]string{}, result.Alignment.Issues...)
	m.health = &cached
	m.healthMu.Unlock()
	return result, nil
}

func validHealth(result RuntimeHealth, accelerator string) bool {
	if result.Alignment.Issues == nil || result.DetectedGPU == "" {
		return false
	}
	switch result.GPUTest.State {
	case "not_checked", "failed", "success", "not_applicable":
	default:
		return false
	}
	switch result.Alignment.Readiness {
	case "not_ready":
		return len(result.Alignment.Issues) > 0
	case "ready":
		return len(result.Alignment.Issues) == 0 && ((accelerator == "cuda" && result.GPUTest.State == "success") || (accelerator == "cpu" && result.GPUTest.State == "not_applicable"))
	default:
		return false
	}
}
