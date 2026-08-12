package config

import "os"

type Config struct {
	Addr         string
	DataDir      string
	FixtureDir   string
	KOReaderUser string
	KOReaderKey  string
}

func Load() Config {
	return Config{
		Addr:         envOr("ALDUS_ADDR", ":8080"),
		DataDir:      envOr("ALDUS_DATA_DIR", "/data"),
		FixtureDir:   envOr("ALDUS_FIXTURE_DIR", "../test-fixtures/alice/media"),
		KOReaderUser: envOr("ALDUS_KOREADER_USER", "aldus"),
		KOReaderKey:  envOr("ALDUS_KOREADER_KEY", "aldus"),
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
