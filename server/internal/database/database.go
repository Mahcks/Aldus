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

//go:embed migrations/022_acquisition_tracking.sql
var acquisitionTrackingSchema string

//go:embed migrations/023_acquisition_recovery.sql
var acquisitionRecoverySchema string

//go:embed migrations/024_user_work_statuses.sql
var userWorkStatusesSchema string

//go:embed migrations/025_source_auto_import.sql
var sourceAutoImportSchema string

//go:embed migrations/026_acquisition_permissions.sql
var acquisitionPermissionsSchema string

//go:embed migrations/027_acquisition_policy.sql
var acquisitionPolicySchema string

//go:embed migrations/028_title_requests.sql
var titleRequestsSchema string

//go:embed migrations/029_notifications.sql
var notificationsSchema string

//go:embed migrations/030_collections.sql
var collectionsSchema string

//go:embed migrations/031_acquisition_download_monitoring.sql
var acquisitionDownloadMonitoringSchema string

//go:embed migrations/032_acquisition_import_outcomes.sql
var acquisitionImportOutcomesSchema string

//go:embed migrations/033_managed_media.sql
var managedMediaSchema string

//go:embed migrations/034_acquisition_release_failures.sql
var acquisitionReleaseFailuresSchema string

//go:embed migrations/035_work_descriptions.sql
var workDescriptionsSchema string

//go:embed migrations/036_exclusive_library_grants.sql
var exclusiveLibraryGrantsSchema string

//go:embed migrations/037_work_publisher_details.sql
var workPublisherDetailsSchema string

//go:embed migrations/038_notification_work_id.sql
var notificationWorkIDSchema string

//go:embed migrations/039_demo_users.sql
var demoUsersSchema string

//go:embed migrations/040_demo_pairing.sql
var demoPairingSchema string

//go:embed migrations/041_account_deletion.sql
var accountDeletionSchema string

var migrations = []string{initialSchema, authenticationSchema, catalogSchema, mediaIngestionSchema, alignmentJobsSchema, userReadingStateSchema, librarySourcesSchema, sourceScansSchema, importProposalsSchema, importAcceptanceSchema, readerPreferencesSchema, readingActivitySchema, workCoversSchema, embeddedCoversSchema, coverStudioSchema, readerCredentialsSchema, acquisitionRequestsSchema, acquisitionSettingsSchema, acquisitionCompletionSchema, acquisitionFulfillmentSchema, acquisitionPairsAndPreferencesSchema, acquisitionTrackingSchema, acquisitionRecoverySchema, userWorkStatusesSchema, sourceAutoImportSchema, acquisitionPermissionsSchema, acquisitionPolicySchema, titleRequestsSchema, notificationsSchema, collectionsSchema, acquisitionDownloadMonitoringSchema, acquisitionImportOutcomesSchema, managedMediaSchema, acquisitionReleaseFailuresSchema, workDescriptionsSchema, exclusiveLibraryGrantsSchema, workPublisherDetailsSchema, notificationWorkIDSchema, demoUsersSchema, demoPairingSchema, accountDeletionSchema}

func SupportedSchemaVersion() int { return len(migrations) }

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
		if next == 41 {
			if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
				return fmt.Errorf("disable foreign keys for migration %d: %w", next, err)
			}
		}
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
		if next == 41 {
			if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys=ON`); err != nil {
				return fmt.Errorf("enable foreign keys after migration %d: %w", next, err)
			}
			var table string
			if err := db.QueryRowContext(ctx, `SELECT "table" FROM pragma_foreign_key_check LIMIT 1`).Scan(&table); err != sql.ErrNoRows {
				if err == nil {
					return fmt.Errorf("migration %d left foreign key violation in %s", next, table)
				}
				return fmt.Errorf("check migration %d foreign keys: %w", next, err)
			}
		}
		version = next
	}
	return nil
}
