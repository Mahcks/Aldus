package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/mahcks/aldus/server/internal/acquisition"
	"github.com/mahcks/aldus/server/internal/alignment"
	"github.com/mahcks/aldus/server/internal/api"
	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/auth"
	"github.com/mahcks/aldus/server/internal/backup"
	"github.com/mahcks/aldus/server/internal/catalog"
	"github.com/mahcks/aldus/server/internal/collection"
	"github.com/mahcks/aldus/server/internal/config"
	"github.com/mahcks/aldus/server/internal/database"
	"github.com/mahcks/aldus/server/internal/diagnostics"
	"github.com/mahcks/aldus/server/internal/genretag"
	"github.com/mahcks/aldus/server/internal/ingest"
	"github.com/mahcks/aldus/server/internal/notification"
	"github.com/mahcks/aldus/server/internal/position"
	"github.com/mahcks/aldus/server/internal/source"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(os.Args) > 1 && (os.Args[1] == "backup" || os.Args[1] == "restore" || os.Args[1] == "reset-password") {
		command := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
		dataDir := command.String("data-dir", "/data", "Aldus data directory")
		archive := command.String("archive", "", "backup archive path")
		username := command.String("username", "", "administrator username")
		_ = command.Parse(os.Args[2:])
		if os.Args[1] == "reset-password" {
			if strings.TrimSpace(*username) == "" {
				fmt.Fprintln(os.Stderr, "--username is required")
				os.Exit(2)
			}
			databasePath := filepath.Join(*dataDir, "aldus.db")
			if info, err := os.Stat(databasePath); err != nil || !info.Mode().IsRegular() {
				fmt.Fprintln(os.Stderr, "Aldus database was not found:", databasePath)
				os.Exit(1)
			}
			db, err := database.Open(ctx, databasePath)
			if err != nil {
				fmt.Fprintln(os.Stderr, "open database:", err)
				os.Exit(1)
			}
			defer db.Close()
			store, err := auth.New(db, auth.Options{})
			if err != nil {
				fmt.Fprintln(os.Stderr, "open authentication database:", err)
				os.Exit(1)
			}
			temporaryPassword, err := store.ResetAdministratorPasswordFromHost(ctx, *username)
			if err != nil {
				fmt.Fprintln(os.Stderr, "reset administrator password:", err)
				os.Exit(1)
			}
			fmt.Println("Temporary password:", temporaryPassword)
			fmt.Println("Sign in and finish account setup immediately. All previous sessions were revoked.")
			return
		}
		if *archive == "" {
			fmt.Fprintln(os.Stderr, "--archive is required")
			os.Exit(2)
		}
		if os.Args[1] == "backup" {
			err := backup.Create(ctx, *dataDir, *archive, version)
			if err != nil {
				fmt.Fprintln(os.Stderr, "backup failed:", err)
				os.Exit(1)
			}
			fmt.Println("Backup verified:", *archive)
			return
		}
		if err := backup.Restore(ctx, *archive, *dataDir); err != nil {
			fmt.Fprintln(os.Stderr, "restore failed:", err)
			os.Exit(1)
		}
		fmt.Println("Restore verified:", *dataDir)
		return
	}
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel, AddSource: cfg.LogLevel == slog.LevelDebug})))
	fmt.Fprintf(os.Stdout, "\n  ALDUS  ·  your library, in sync\n  %s  |  %s  |  log=%s\n\n", version, cfg.Environment, strings.ToLower(cfg.LogLevel.String()))
	slog.Info("starting Aldus", "version", version, "environment", cfg.Environment)
	if version == "dev" {
		slog.Warn("development build", "diagnosis", "not intended for production")
	}
	slog.Debug(
		"runtime configuration",
		"addr", cfg.Addr,
		"data_dir", cfg.DataDir,
		"media_dir", cfg.MediaDir,
		"source_roots", len(cfg.SourceRoots),
		"allowed_origins", len(cfg.AllowedOrigins),
		"secure_cookies", cfg.SecureCookies,
		"alignment_timeout", cfg.AlignmentTimeout,
	)
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		slog.Error("create data directory", "error", err)
		os.Exit(1)
	}
	databasePath := filepath.Join(cfg.DataDir, "aldus.db")
	db, err := database.Open(ctx, databasePath)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	slog.Debug("database ready", "path", databasePath)
	store := position.New(db)
	catalogStore := catalog.New(db)
	genreTagStore := genretag.New(db)
	collectionStore := collection.New(db)
	mediaDir := cfg.MediaDir
	if mediaDir == "" {
		mediaDir = filepath.Join(cfg.DataDir, "media")
	}
	sourceStore, err := source.New(db, source.Options{
		AllowedRoots: cfg.SourceRoots,
		ManagedRoot:  mediaDir,
		DataRoot:     cfg.DataDir,
		MaxBytes:     cfg.MaxUploadBytes,
	})
	if err != nil {
		slog.Error("open library sources", "error", err)
		db.Close()
		os.Exit(1)
	}
	if err := sourceStore.Start(ctx); err != nil {
		slog.Error("recover source scans", "error", err)
		db.Close()
		os.Exit(1)
	}
	slog.Debug("library source scanner ready", "roots", len(cfg.SourceRoots))
	ingestStore, err := ingest.New(db, ingest.Options{
		Root:     mediaDir,
		MaxBytes: cfg.MaxUploadBytes,
		Resolver: sourceStore,
	})
	if err != nil {
		slog.Error("open media storage", "error", err)
		db.Close()
		os.Exit(1)
	}
	alignmentManager, err := alignment.New(db, alignment.Options{
		MediaRoot:    mediaDir,
		Media:        sourceStore,
		ArtifactRoot: filepath.Join(cfg.DataDir, "alignments"),
		ModelRoot:    cfg.AlignmentModelDir,
		Command:      strings.Fields(cfg.AlignmentCommand),
		Timeout:      cfg.AlignmentTimeout,
	})
	if err != nil {
		slog.Error("open alignment worker", "error", err)
		db.Close()
		os.Exit(1)
	}
	updated, skipped, err := alignmentManager.BackfillKOReader(ctx)
	if err != nil {
		slog.Error("upgrade KOReader alignment locators", "error", err)
		db.Close()
		os.Exit(1)
	}
	if updated > 0 || skipped > 0 {
		slog.Info("KOReader alignment upgrade complete", "updated", updated, "requires_realign", skipped)
	}
	if err := alignmentManager.Start(ctx); err != nil {
		slog.Error("recover alignment jobs", "error", err)
		db.Close()
		os.Exit(1)
	}
	slog.Debug("alignment worker ready")
	if err := store.RemoveLegacyFixture(ctx); err != nil {
		slog.Error("remove legacy synthetic fixture", "error", err)
		db.Close()
		os.Exit(1)
	}
	authStore, err := auth.New(db, auth.Options{
		SecureCookies: cfg.SecureCookies,
		DemoLibraryID: cfg.DemoLibraryID,
	})
	if err != nil {
		slog.Error("open authentication database", "error", err)
		db.Close()
		os.Exit(1)
	}
	if err := authStore.CleanupExpiredDemoUsers(ctx); err != nil {
		slog.Error("clean expired demo users", "error", err)
		db.Close()
		os.Exit(1)
	}
	acquisitionClient, err := acquisition.New(acquisition.Options{
		IndexerKind:   cfg.IndexerKind,
		IndexerURL:    cfg.IndexerURL,
		IndexerAPIKey: cfg.IndexerAPIKey,
		QBitURL:       cfg.QBitTorrentURL,
		QBitUsername:  cfg.QBitTorrentUser,
		QBitPassword:  cfg.QBitTorrentPass,
		Category:      cfg.QBitTorrentCategory,
		DownloadRoot:  cfg.QBitTorrentDownloadRoot,
	})
	if err != nil {
		slog.Error("configure acquisition", "error", err)
		db.Close()
		os.Exit(1)
	}
	acquisitionStore := acquisition.NewStore(db, acquisitionClient)
	acquisitionStore.SetDownloadIngress(cfg.DownloadIngress)
	acquisitionPolicyStore := acquisition.NewPolicyStore(db)
	titleRequestStore := acquisition.NewTitleRequestStore(db)
	notificationStore := notification.New(db)
	diagnosticStore := diagnostics.New(db, cfg.DataDir, cfg.SourceRoots, version, cfg.Environment)
	backupManager := backup.NewManager(cfg.DataDir, cfg.BackupDir, version)
	if err := sourceStore.EnsureManagedSources(ctx); err != nil {
		slog.Error("create managed acquisition sources", "error", err)
		db.Close()
		os.Exit(1)
	}
	acquisitionStore.SetHandoff(sourceStore.EnqueueAcquisitionScan)
	acquisitionStore.SetScanRetry(sourceStore.RetryAcquisitionScan)
	acquisitionStore.SetPairHandoff(func(ctx context.Context, pair acquisition.ReadyPair) error {
		_, err := alignmentManager.EnqueueAcquiredPair(
			ctx,
			alignment.Request{
				EPUBMediaID:  pair.EPUBMediaID,
				EPUBSHA256:   pair.EPUBSHA256,
				AudioMediaID: pair.AudioMediaID,
				AudioSHA256:  pair.AudioSHA256,
			},
		)
		return err
	})
	titleRequestStore.SetAcquisitionStore(acquisitionStore)
	titleRequestStore.SetNotificationStore(notificationStore)
	acquisitionStore.Start(ctx)
	titleRequestStore.Start(ctx)
	server := &http.Server{
		Addr: cfg.Addr,
		Handler: api.Handler(api.Dependencies{
			Web: os.DirFS("public"), Position: store, Auth: authStore,
			Catalog: catalogStore, Collections: collectionStore, Ingest: ingestStore, Sources: sourceStore, AlignmentJobs: alignmentManager,
			Acquisitions:        acquisitionStore,
			AcquisitionPolicies: acquisitionPolicyStore,
			TitleRequests:       titleRequestStore,
			Notifications:       notificationStore,
			Diagnostics:         diagnosticStore,
			GenreTags:           genreTagStore,
			Backups:             backupManager,
			KOReader:            koreader.Credentials{User: cfg.KOReaderUser, Key: cfg.KOReaderKey}, AllowedOrigins: cfg.AllowedOrigins, TrustProxyHeaders: cfg.TrustProxyHeaders,
			Ready: func(ctx context.Context) error {
				if err := db.PingContext(ctx); err != nil {
					return fmt.Errorf("database: %w", err)
				}
				probe, err := os.CreateTemp(cfg.DataDir, ".aldus-ready-*")
				if err != nil {
					return fmt.Errorf("data directory: %w", err)
				}
				name := probe.Name()
				if err := probe.Close(); err != nil {
					return fmt.Errorf("data directory: %w", err)
				}
				if err := os.Remove(name); err != nil {
					return fmt.Errorf("data directory: %w", err)
				}
				return nil
			},
		}),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("Aldus is ready", "addr", cfg.Addr, "version", version, "environment", cfg.Environment, "data_dir", cfg.DataDir)
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		stop()
		alignmentManager.Wait()
		sourceStore.Wait()
		if !errors.Is(err, http.ErrServerClosed) {
			slog.Error("serve HTTP", "error", err)
			db.Close()
			os.Exit(1)
		}
		db.Close()
		return
	case <-ctx.Done():
		slog.Info("shutdown requested", "signal", "interrupt")
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err = server.Shutdown(shutdownCtx)
	cancel()
	if err != nil {
		slog.Error("shut down HTTP server", "error", err)
		alignmentManager.Wait()
		db.Close()
		os.Exit(1)
	}
	if err = <-errCh; !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve HTTP", "error", err)
		db.Close()
		os.Exit(1)
	}
	alignmentManager.Wait()
	sourceStore.Wait()
	if err := db.Close(); err != nil {
		slog.Error("close database", "error", err)
		os.Exit(1)
	}
	slog.Info("shutdown complete")
}
