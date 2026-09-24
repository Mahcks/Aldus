package v1

import (
	"errors"
	"net/http"
	"time"

	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api/contracts"
)

func alignmentHealth(manager *alignment.Manager, test bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := actor(r)
		if !user.Admin {
			http.Error(w, "administrator access required", http.StatusForbidden)
			return
		}
		if manager == nil {
			http.Error(w, "alignment worker is not configured", http.StatusServiceUnavailable)
			return
		}
		var value alignment.RuntimeHealth
		var err error
		if test {
			value, err = manager.TestRuntime(r.Context(), user)
		} else {
			value, err = manager.RuntimeHealth(user)
		}
		if errors.Is(err, alignment.ErrRuntimeBusy) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		if err != nil {
			http.Error(w, "alignment diagnostics unavailable", http.StatusInternalServerError)
			return
		}
		result := contracts.AlignmentGpuStatus{
			Accelerator:      value.Accelerator,
			AcceleratorLabel: value.AcceleratorLabel,
			DetectedGPU:      value.DetectedGPU,
			GPUTest:          contracts.GpuTestResult{State: value.GPUTest.State, Detail: value.GPUTest.Detail, Error: value.GPUTest.Error},
			Alignment:        contracts.AlignmentReadiness{Readiness: value.Alignment.Readiness, Issues: value.Alignment.Issues},
		}
		if value.LastCheckedAt != nil {
			timestamp := value.LastCheckedAt.Format(time.RFC3339Nano)
			result.LastCheckedAt = &timestamp
		}
		writeJSON(w, http.StatusOK, result)
	}
}
