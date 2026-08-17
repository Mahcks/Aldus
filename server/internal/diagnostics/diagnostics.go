package diagnostics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mahcks/aldus/server/internal/auth"
)

var ErrForbidden = errors.New("administrator access required")

type Report struct {
	Version, Environment, DatabaseStatus, StorageStatus string
	SchemaVersion                                       int
	SourceRootsConfigured, SourceRootsReachable         int
	PendingSourceScans, FailedSourceScans               int
	PendingAlignmentJobs, FailedAlignmentJobs           int
	AcquisitionConfigured                               bool
}

type Store struct {
	db          *sql.DB
	dataDir     string
	sourceRoots []string
	version     string
	environment string
}

func New(db *sql.DB, dataDir string, sourceRoots []string, version, environment string) *Store {
	return &Store{db: db, dataDir: dataDir, sourceRoots: sourceRoots, version: version, environment: environment}
}

func (s *Store) Report(ctx context.Context, actor auth.User) (Report, error) {
	if !actor.Admin {
		return Report{}, ErrForbidden
	}
	report := Report{Version: s.version, Environment: s.environment, SourceRootsConfigured: len(s.sourceRoots)}
	var quickCheck string
	if err := s.db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&quickCheck); err != nil {
		return Report{}, fmt.Errorf("check database: %w", err)
	}
	report.DatabaseStatus = quickCheck
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&report.SchemaVersion); err != nil {
		return Report{}, fmt.Errorf("read schema version: %w", err)
	}
	probe, err := os.CreateTemp(s.dataDir, ".aldus-diagnostic-*")
	if err != nil {
		report.StorageStatus = err.Error()
	} else {
		name := probe.Name()
		if closeErr := probe.Close(); closeErr != nil {
			report.StorageStatus = closeErr.Error()
		} else if removeErr := os.Remove(name); removeErr != nil {
			report.StorageStatus = removeErr.Error()
		} else {
			report.StorageStatus = "ok"
		}
	}
	for _, root := range s.sourceRoots {
		if info, err := os.Stat(filepath.Clean(root)); err == nil && info.IsDir() {
			report.SourceRootsReachable++
		}
	}
	queries := []struct {
		destination *int
		query       string
	}{
		{&report.PendingSourceScans, `SELECT COUNT(*) FROM source_scans WHERE state IN ('pending','processing')`},
		{&report.FailedSourceScans, `SELECT COUNT(*) FROM source_scans WHERE state='failed'`},
		{&report.PendingAlignmentJobs, `SELECT COUNT(*) FROM alignment_jobs WHERE state IN ('pending','processing')`},
		{&report.FailedAlignmentJobs, `SELECT COUNT(*) FROM alignment_jobs WHERE state='failed'`},
	}
	for _, query := range queries {
		if err := s.db.QueryRowContext(ctx, query.query).Scan(query.destination); err != nil {
			return Report{}, fmt.Errorf("read operational queue: %w", err)
		}
	}
	var acquisition int
	err = s.db.QueryRowContext(ctx, `SELECT CASE WHEN indexer_url!='' AND qbittorrent_url!='' THEN 1 ELSE 0 END FROM acquisition_settings WHERE id=1`).Scan(&acquisition)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Report{}, fmt.Errorf("read acquisition configuration: %w", err)
	}
	report.AcquisitionConfigured = acquisition != 0
	return report, nil
}
