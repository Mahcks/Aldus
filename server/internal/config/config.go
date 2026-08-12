package config

import (
	"os"
	"strconv"
)

type Config struct {
	Addr           string
	DataDir        string
	FixtureDir     string
	KOReaderUser   string
	KOReaderKey    string
	BootstrapToken string
	SecureCookies  bool
	MediaDir       string
	MaxUploadBytes int64
}

func Load() Config {
	return Config{
		Addr:           envOr("ALDUS_ADDR", ":8080"),
		DataDir:        envOr("ALDUS_DATA_DIR", "/data"),
		FixtureDir:     envOr("ALDUS_FIXTURE_DIR", "../test-fixtures/alice/media"),
		KOReaderUser:   envOr("ALDUS_KOREADER_USER", "aldus"),
		KOReaderKey:    envOr("ALDUS_KOREADER_KEY", "aldus"),
		BootstrapToken: os.Getenv("ALDUS_BOOTSTRAP_TOKEN"),
		SecureCookies:  envBool("ALDUS_SECURE_COOKIES"),
		MediaDir:       envOr("ALDUS_MEDIA_DIR", ""),
		MaxUploadBytes: envInt64("ALDUS_MAX_UPLOAD_BYTES", 2<<30),
	}
}

func envInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(key), 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envBool(key string) bool {
	value, _ := strconv.ParseBool(os.Getenv(key))
	return value
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
