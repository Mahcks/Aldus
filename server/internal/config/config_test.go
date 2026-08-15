package config

import (
	"log/slog"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	t.Setenv("ALDUS_ADDR", "localhost:9000")
	t.Setenv("ALDUS_DATA_DIR", "/tmp/aldus")
	t.Setenv("ALDUS_FIXTURE_DIR", "/tmp/alice")
	t.Setenv("ALDUS_KOREADER_USER", "reader")
	t.Setenv("ALDUS_KOREADER_KEY", "secret")
	t.Setenv("ALDUS_BOOTSTRAP_TOKEN", "bootstrap-secret")
	t.Setenv("ALDUS_SECURE_COOKIES", "true")
	t.Setenv("ALDUS_ALLOWED_ORIGINS", " http://localhost:8081,https://aldus.example ")
	t.Setenv("ALDUS_MEDIA_DIR", "/tmp/media")
	t.Setenv("ALDUS_MAX_UPLOAD_BYTES", "12345")
	t.Setenv("ALDUS_ALIGNMENT_COMMAND", "worker --fixed")
	t.Setenv("ALDUS_ALIGNMENT_TIMEOUT_SECONDS", "45")
	t.Setenv("ALDUS_ALIGNMENT_MODEL_DIR", "/tmp/models")
	t.Setenv("ALDUS_ENV", "development")
	t.Setenv("ALDUS_LOG_LEVEL", "debug")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "localhost:9000" || cfg.DataDir != "/tmp/aldus" || cfg.FixtureDir != "/tmp/alice" || cfg.KOReaderUser != "reader" || cfg.KOReaderKey != "secret" || cfg.BootstrapToken != "bootstrap-secret" || !cfg.SecureCookies || len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "http://localhost:8081" || cfg.AllowedOrigins[1] != "https://aldus.example" || cfg.MediaDir != "/tmp/media" || cfg.MaxUploadBytes != 12345 || cfg.AlignmentCommand != "worker --fixed" || cfg.AlignmentTimeout != 45*time.Second || cfg.AlignmentModelDir != "/tmp/models" || cfg.Environment != "development" || cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("Load() = %#v", cfg)
	}
}

func TestLoadRejectsInvalidLogLevel(t *testing.T) {
	t.Setenv("ALDUS_LOG_LEVEL", "verbose")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid log level error")
	}
}
