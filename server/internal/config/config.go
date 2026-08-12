package config

import "os"

type Config struct {
	Addr    string
	DataDir string
}

func Load() Config {
	return Config{
		Addr:    envOr("ALDUS_ADDR", ":8080"),
		DataDir: envOr("ALDUS_DATA_DIR", "/data"),
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
