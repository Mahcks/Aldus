package contracts

type SystemDiagnostics struct {
	Version                 string `json:"version"`
	Environment             string `json:"environment"`
	SchemaVersion           int    `json:"schema_version"`
	DatabaseStatus          string `json:"database_status"`
	StorageStatus           string `json:"storage_status"`
	SourceRootsConfigured   int    `json:"source_roots_configured"`
	SourceRootsReachable    int    `json:"source_roots_reachable"`
	PendingSourceScans      int    `json:"pending_source_scans"`
	FailedSourceScans       int    `json:"failed_source_scans"`
	PendingAlignmentJobs    int    `json:"pending_alignment_jobs"`
	FailedAlignmentJobs     int    `json:"failed_alignment_jobs"`
	AcquisitionConfigured   bool   `json:"acquisition_configured"`
	ManagedAcquisitionFiles int    `json:"managed_acquisition_files"`
	ExternalMediaExcluded   int    `json:"external_media_excluded"`
}

type AlignmentGpuStatus struct {
	Accelerator      string             `json:"accelerator" tstype:"'cpu' | 'cuda' | 'unknown'"`
	AcceleratorLabel string             `json:"acceleratorLabel"`
	DetectedGPU      string             `json:"detectedGpu"`
	GPUTest          GpuTestResult      `json:"gpuTest"`
	Alignment        AlignmentReadiness `json:"alignment"`
	LastCheckedAt    *string            `json:"lastCheckedAt" tstype:"string | null"`
}

type GpuTestResult struct {
	State  string `json:"state" tstype:"'not_checked' | 'checking' | 'success' | 'failed' | 'not_applicable'"`
	Detail string `json:"detail,omitempty"`
	Error  string `json:"error,omitempty"`
}

type AlignmentReadiness struct {
	Readiness string   `json:"readiness" tstype:"'unknown' | 'ready' | 'not_ready'"`
	Issues    []string `json:"issues"`
}
