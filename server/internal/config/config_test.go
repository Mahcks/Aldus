package config

import "testing"

func TestLoad(t *testing.T) {
	t.Setenv("ALDUS_ADDR", "localhost:9000")
	t.Setenv("ALDUS_DATA_DIR", "/tmp/aldus")
	t.Setenv("ALDUS_FIXTURE_DIR", "/tmp/alice")
	t.Setenv("ALDUS_KOREADER_USER", "reader")
	t.Setenv("ALDUS_KOREADER_KEY", "secret")
	t.Setenv("ALDUS_BOOTSTRAP_TOKEN", "bootstrap-secret")
	t.Setenv("ALDUS_SECURE_COOKIES", "true")
	cfg := Load()
	if cfg.Addr != "localhost:9000" || cfg.DataDir != "/tmp/aldus" || cfg.FixtureDir != "/tmp/alice" || cfg.KOReaderUser != "reader" || cfg.KOReaderKey != "secret" || cfg.BootstrapToken != "bootstrap-secret" || !cfg.SecureCookies {
		t.Fatalf("Load() = %#v", cfg)
	}
}
