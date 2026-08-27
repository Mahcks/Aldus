package config

import (
	"log/slog"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	t.Setenv("ALDUS_ADDR", "localhost:9000")
	t.Setenv("ALDUS_DATA_DIR", "/tmp/aldus")
	t.Setenv("ALDUS_BACKUP_DIR", "/tmp/backups")
	t.Setenv("ALDUS_KOREADER_USER", "reader")
	t.Setenv("ALDUS_KOREADER_KEY", "secret")
	t.Setenv("ALDUS_SECURE_COOKIES", "true")
	t.Setenv("ALDUS_ALLOWED_ORIGINS", " http://localhost:8081,https://aldus.example ")
	t.Setenv("ALDUS_MEDIA_DIR", "/tmp/media")
	t.Setenv("ALDUS_MAX_UPLOAD_BYTES", "12345")
	t.Setenv("ALDUS_ALIGNMENT_COMMAND", "worker --fixed")
	t.Setenv("ALDUS_ALIGNMENT_TIMEOUT_SECONDS", "45")
	t.Setenv("ALDUS_ALIGNMENT_MODEL_DIR", "/tmp/models")
	t.Setenv("ALDUS_ENV", "development")
	t.Setenv("ALDUS_LOG_LEVEL", "debug")
	t.Setenv("ALDUS_INDEXER_URL", "https://indexer.example/api")
	t.Setenv("ALDUS_INDEXER_API_KEY", "indexer-key")
	t.Setenv("ALDUS_QBITTORRENT_URL", "https://qbit.example")
	t.Setenv("ALDUS_QBITTORRENT_USERNAME", "aldus")
	t.Setenv("ALDUS_QBITTORRENT_PASSWORD", "download-key")
	t.Setenv("ALDUS_QBITTORRENT_CATEGORY", "books")
	t.Setenv("ALDUS_QBITTORRENT_DOWNLOAD_ROOT", "/downloads")
	t.Setenv("ALDUS_DOWNLOAD_INGRESS", "/mnt/completed")
	t.Setenv("ALDUS_DEMO_LIBRARY_ID", "public-demo")
	t.Setenv("ALDUS_TRUST_PROXY_HEADERS", "true")
	t.Setenv("ALDUS_BIND_HOST", "0.0.0.0")
	t.Setenv("ALDUS_ALLOW_INSECURE_HTTP", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "localhost:9000" || cfg.DataDir != "/tmp/aldus" || cfg.BackupDir != "/tmp/backups" || cfg.KOReaderUser != "reader" || cfg.KOReaderKey != "secret" || !cfg.SecureCookies || len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "http://localhost:8081" || cfg.AllowedOrigins[1] != "https://aldus.example" || cfg.MediaDir != "/tmp/media" || cfg.MaxUploadBytes != 12345 || cfg.AlignmentCommand != "worker --fixed" || cfg.AlignmentTimeout != 45*time.Second || cfg.AlignmentModelDir != "/tmp/models" || cfg.Environment != "development" || cfg.LogLevel != slog.LevelDebug || cfg.IndexerKind != "prowlarr" || cfg.IndexerURL != "https://indexer.example/api" || cfg.IndexerAPIKey != "indexer-key" || cfg.QBitTorrentURL != "https://qbit.example" || cfg.QBitTorrentUser != "aldus" || cfg.QBitTorrentPass != "download-key" || cfg.QBitTorrentCategory != "books" || cfg.QBitTorrentDownloadRoot != "/downloads" || cfg.DownloadIngress != "/mnt/completed" || cfg.DemoLibraryID != "public-demo" || !cfg.TrustProxyHeaders || cfg.BindHost != "0.0.0.0" || !cfg.AllowInsecureHTTP {
		t.Fatalf("Load() = %#v", cfg)
	}
}

func TestLoadRequiresExplicitNonLoopbackHTTP(t *testing.T) {
	t.Setenv("ALDUS_ENV", "production")
	t.Setenv("ALDUS_ADDR", "0.0.0.0:8080")
	if _, err := Load(); err == nil {
		t.Fatal("expected direct non-loopback plain HTTP to require acknowledgement")
	}
	t.Setenv("ALDUS_ALLOW_INSECURE_HTTP", "true")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadDefaultsDirectListenerToLoopback(t *testing.T) {
	t.Setenv("ALDUS_ENV", "production")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:8080" {
		t.Fatalf("Addr = %q", cfg.Addr)
	}
}

func TestLoadAcceptsComposeLoopbackPublication(t *testing.T) {
	t.Setenv("ALDUS_ENV", "production")
	t.Setenv("ALDUS_ADDR", ":8080")
	t.Setenv("ALDUS_BIND_HOST", "127.0.0.1")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadRejectsInvalidLogLevel(t *testing.T) {
	t.Setenv("ALDUS_LOG_LEVEL", "verbose")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid log level error")
	}
}
