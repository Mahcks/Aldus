package alignment

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/mahcks/aldus/server/internal/auth"
)

func TestHealthWorkerProcess(t *testing.T) {
	if os.Getenv("ALDUS_HEALTH_HELPER") != "1" {
		return
	}
	if os.Getenv("HF_HUB_OFFLINE") != "1" || os.Getenv("TRANSFORMERS_OFFLINE") != "1" {
		os.Exit(3)
	}
	if os.Getenv("HF_HOME") != "/configured-models" || os.Getenv("TORCH_HOME") != "/configured-models/torch" {
		os.Exit(4)
	}
	fmt.Print(os.Getenv("ALDUS_HEALTH_RESPONSE"))
	os.Exit(0)
}

func healthManager() *Manager {
	return &Manager{runtimeSlot: make(chan struct{}, 1), cancel: map[string]context.CancelFunc{}, options: Options{
		Command: []string{os.Args[0], "-test.run=^TestHealthWorkerProcess$", "--"},
		Model:   "base.en", ModelRoot: "/configured-models", ArtifactRoot: "/artifacts",
	}}
}

func TestRuntimeHealthChecksAndValidation(t *testing.T) {
	t.Setenv("ALDUS_HEALTH_HELPER", "1")
	admin := auth.User{Admin: true}
	for _, test := range []struct{ name, accelerator, response, state string }{
		{"cpu", "cpu", `{"detectedGpu":"CPU configured","gpuTest":{"state":"not_applicable"},"alignment":{"readiness":"ready","issues":[]}}`, "ready"},
		{"cuda", "cuda", `{"detectedGpu":"GTX 1050 Ti","gpuTest":{"state":"success"},"alignment":{"readiness":"ready","issues":[]}}`, "ready"},
		{"missing models", "cuda", `{"detectedGpu":"GTX 1050 Ti","gpuTest":{"state":"success"},"alignment":{"readiness":"not_ready","issues":["models missing"]}}`, "not_ready"},
		{"invalid ready", "cuda", `{"detectedGpu":"None","gpuTest":{"state":"failed"},"alignment":{"readiness":"ready","issues":[]}}`, "not_ready"},
		{"invalid JSON", "cpu", `not json`, "not_ready"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("ALDUS_ALIGNMENT_ACCELERATOR", test.accelerator)
			t.Setenv("ALDUS_HEALTH_RESPONSE", test.response)
			manager := healthManager()
			before, err := manager.RuntimeHealth(admin)
			if err != nil || before.Alignment.Readiness != "unknown" || before.LastCheckedAt != nil {
				t.Fatalf("initial = %+v, %v", before, err)
			}
			result, err := manager.TestRuntime(context.Background(), admin)
			if err != nil || result.Alignment.Readiness != test.state || result.LastCheckedAt == nil {
				t.Fatalf("result = %+v, %v", result, err)
			}
			cached, err := manager.RuntimeHealth(admin)
			if err != nil || cached.Alignment.Readiness != test.state || cached.LastCheckedAt == nil {
				t.Fatalf("cached = %+v, %v", cached, err)
			}
		})
	}
}

func TestRuntimeHealthAuthorizationBusyAndCancellation(t *testing.T) {
	manager := healthManager()
	if _, err := manager.TestRuntime(context.Background(), auth.User{}); !errors.Is(err, ErrHealthForbidden) {
		t.Fatal(err)
	}
	if _, err := manager.RuntimeHealth(auth.User{}); !errors.Is(err, ErrHealthForbidden) {
		t.Fatal(err)
	}
	manager.runtimeSlot <- struct{}{}
	if _, err := manager.TestRuntime(context.Background(), auth.User{Admin: true}); !errors.Is(err, ErrRuntimeBusy) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	<-manager.runtimeSlot
	result, err := manager.TestRuntime(ctx, auth.User{Admin: true})
	if err != nil || result.Alignment.Readiness != "not_ready" {
		t.Fatalf("canceled check = %+v, %v", result, err)
	}
	if len(manager.runtimeSlot) != 0 {
		t.Fatal("runtime slot leaked")
	}
}

func TestRuntimeHealthAfterShutdown(t *testing.T) {
	manager := healthManager()
	manager.stopAll()
	result, err := manager.TestRuntime(context.Background(), auth.User{Admin: true})
	if err != nil || result.Alignment.Readiness != "not_ready" {
		t.Fatalf("stopped worker = %+v, %v", result, err)
	}
}
