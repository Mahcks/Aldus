package database

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

var migrations = loadMigrations()

func loadMigrations() []string {
	names, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		panic(fmt.Sprintf("list migrations: %v", err))
	}
	migrations := make([]string, len(names))
	for index, name := range names {
		if !strings.HasPrefix(name, fmt.Sprintf("migrations/%03d_", index+1)) {
			panic(fmt.Sprintf("migration %d is missing or out of order", index+1))
		}
		contents, err := migrationFiles.ReadFile(name)
		if err != nil {
			panic(fmt.Sprintf("read migration %s: %v", name, err))
		}
		migrations[index] = string(contents)
	}
	return migrations
}

func SupportedSchemaVersion() int {
	return len(migrations)
}

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
		version = next
	}
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys=ON`); err != nil {
		return fmt.Errorf("enable foreign keys after migrations: %w", err)
	}
	var table string
	if err := db.QueryRowContext(ctx, `SELECT "table" FROM pragma_foreign_key_check LIMIT 1`).Scan(&table); err != sql.ErrNoRows {
		if err == nil {
			return fmt.Errorf("schema version %d has foreign key violation in %s", version, table)
		}
		return fmt.Errorf("check schema version %d foreign keys: %w", version, err)
	}
	return nil
}
