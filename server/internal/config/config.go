package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                    string
	DataDir                 string
	FixtureDir              string
	KOReaderUser            string
	KOReaderKey             string
	BootstrapToken          string
	SecureCookies           bool
	AllowedOrigins          []string
	MediaDir                string
	MaxUploadBytes          int64
	AlignmentCommand        string
	AlignmentTimeout        time.Duration
	AlignmentModelDir       string
	SourceRoots             []string
	Environment             string
	LogLevel                slog.Level
	IndexerKind             string
	IndexerURL              string
	IndexerAPIKey           string
	QBitTorrentURL          string
	QBitTorrentUser         string
	QBitTorrentPass         string
	QBitTorrentCategory     string
	QBitTorrentDownloadRoot string
}

func Load() (Config, error) {
	level, err := parseLogLevel(envOr("ALDUS_LOG_LEVEL", "info"))
	if err != nil {
		return Config{}, err
	}
	return Config{
		Addr:                    envOr("ALDUS_ADDR", ":8080"),
		DataDir:                 envOr("ALDUS_DATA_DIR", "/data"),
		FixtureDir:              envOr("ALDUS_FIXTURE_DIR", "../test-fixtures/alice/media"),
		KOReaderUser:            os.Getenv("ALDUS_KOREADER_USER"),
		KOReaderKey:             os.Getenv("ALDUS_KOREADER_KEY"),
		BootstrapToken:          os.Getenv("ALDUS_BOOTSTRAP_TOKEN"),
		SecureCookies:           envBool("ALDUS_SECURE_COOKIES"),
		AllowedOrigins:          envList("ALDUS_ALLOWED_ORIGINS"),
		MediaDir:                envOr("ALDUS_MEDIA_DIR", ""),
		MaxUploadBytes:          envInt64("ALDUS_MAX_UPLOAD_BYTES", 2<<30),
		AlignmentCommand:        envOr("ALDUS_ALIGNMENT_COMMAND", "python3 ../tools/whisperx_worker.py"),
		AlignmentTimeout:        time.Duration(envInt64("ALDUS_ALIGNMENT_TIMEOUT_SECONDS", 7200)) * time.Second,
		AlignmentModelDir:       os.Getenv("ALDUS_ALIGNMENT_MODEL_DIR"),
		SourceRoots:             envList("ALDUS_SOURCE_ROOTS"),
		Environment:             envOr("ALDUS_ENV", "production"),
		LogLevel:                level,
		IndexerKind:             envOr("ALDUS_INDEXER_KIND", "prowlarr"),
		IndexerURL:              os.Getenv("ALDUS_INDEXER_URL"),
		IndexerAPIKey:           os.Getenv("ALDUS_INDEXER_API_KEY"),
		QBitTorrentURL:          os.Getenv("ALDUS_QBITTORRENT_URL"),
		QBitTorrentUser:         os.Getenv("ALDUS_QBITTORRENT_USERNAME"),
		QBitTorrentPass:         os.Getenv("ALDUS_QBITTORRENT_PASSWORD"),
		QBitTorrentCategory:     envOr("ALDUS_QBITTORRENT_CATEGORY", "aldus"),
		QBitTorrentDownloadRoot: os.Getenv("ALDUS_QBITTORRENT_DOWNLOAD_ROOT"),
	}, nil
}

func parseLogLevel(value string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("invalid ALDUS_LOG_LEVEL %q: use debug, info, warn, or error", value)
	}
}

func envList(key string) []string {
	var values []string
	for _, value := range strings.Split(os.Getenv(key), ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
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
