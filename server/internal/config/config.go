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
	}
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
