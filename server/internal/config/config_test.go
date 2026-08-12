package config

import "testing"

func TestLoad(t *testing.T) {
	t.Setenv("ALDUS_ADDR", "localhost:9000")
	t.Setenv("ALDUS_DATA_DIR", "/tmp/aldus")
	cfg := Load()
	if cfg.Addr != "localhost:9000" || cfg.DataDir != "/tmp/aldus" {
		t.Fatalf("Load() = %#v", cfg)
	}
}
