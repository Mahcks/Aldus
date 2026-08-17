package database

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"net/url"
	"path/filepath"

	_ "modernc.org/sqlite"
)

//go:embed migrations/001_initial.sql
var initialSchema string

//go:embed migrations/002_authentication.sql
var authenticationSchema string

//go:embed migrations/003_catalog.sql
var catalogSchema string

//go:embed migrations/004_media_ingestion.sql
var mediaIngestionSchema string

//go:embed migrations/005_alignment_jobs.sql
var alignmentJobsSchema string

//go:embed migrations/006_user_reading_state.sql
var userReadingStateSchema string

//go:embed migrations/007_library_sources.sql
var librarySourcesSchema string

//go:embed migrations/008_source_scans.sql
var sourceScansSchema string

//go:embed migrations/009_import_proposals.sql
var importProposalsSchema string

//go:embed migrations/010_import_acceptance.sql
var importAcceptanceSchema string

//go:embed migrations/011_reader_preferences.sql
var readerPreferencesSchema string

//go:embed migrations/012_reading_activity.sql
var readingActivitySchema string

//go:embed migrations/013_work_covers.sql
var workCoversSchema string

//go:embed migrations/014_embedded_covers.sql
var embeddedCoversSchema string

//go:embed migrations/015_cover_studio.sql
var coverStudioSchema string

//go:embed migrations/016_reader_credentials.sql
var readerCredentialsSchema string

//go:embed migrations/017_acquisition_requests.sql
var acquisitionRequestsSchema string

//go:embed migrations/018_acquisition_settings.sql
var acquisitionSettingsSchema string

//go:embed migrations/019_acquisition_completion.sql
var acquisitionCompletionSchema string

//go:embed migrations/020_acquisition_fulfillment.sql
var acquisitionFulfillmentSchema string

//go:embed migrations/021_acquisition_pairs_and_preferences.sql
var acquisitionPairsAndPreferencesSchema string

var migrations = []string{initialSchema, authenticationSchema, catalogSchema, mediaIngestionSchema, alignmentJobsSchema, userReadingStateSchema, librarySourcesSchema, sourceScansSchema, importProposalsSchema, importAcceptanceSchema, readerPreferencesSchema, readingActivitySchema, workCoversSchema, embeddedCoversSchema, coverStudioSchema, readerCredentialsSchema, acquisitionRequestsSchema, acquisitionSettingsSchema, acquisitionCompletionSchema, acquisitionFulfillmentSchema, acquisitionPairsAndPreferencesSchema}

func Open(ctx context.Context, path string) (*sql.DB, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve SQLite path: %w", err)
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open SQLite: %w", err)
	}
	// ponytail: one connection makes transaction behavior deterministic; raise only if measured read contention warrants it.
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping SQLite: %w", err)
	}
	if _, err := db.ExecContext(ctx, `PRAGMA journal_mode = WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable SQLite WAL: %w", err)
	}
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate SQLite: %w", err)
	}
	return db, nil
}

func migrate(ctx context.Context, db *sql.DB) error {
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > len(migrations) {
		return fmt.Errorf("database schema version %d is newer than supported version %d", version, len(migrations))
	}
	for version < len(migrations) {
		next := version + 1
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", next, err)
		}
		if _, err := tx.ExecContext(ctx, migrations[version]); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", next, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", next)); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %d: %w", next, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", next, err)
		}
		version = next
	}
	return nil
}
