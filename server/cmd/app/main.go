package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/mahcks/aldus/server/internal/api"
	"github.com/mahcks/aldus/server/internal/api/koreader"
	"github.com/mahcks/aldus/server/internal/config"
	"github.com/mahcks/aldus/server/internal/position"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	cfg := config.Load()
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		slog.Error("create data directory", "error", err)
		os.Exit(1)
	}
	store, err := position.Open(ctx, filepath.Join(cfg.DataDir, "aldus.db"))
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	if err := store.RemoveLegacyFixture(ctx); err != nil {
		slog.Error("remove legacy synthetic fixture", "error", err)
		store.Close()
		os.Exit(1)
	}
	server := &http.Server{
		Addr: cfg.Addr,
		Handler: api.Handler(os.DirFS("public"), http.Dir(cfg.FixtureDir), store, koreader.Credentials{
			User: cfg.KOReaderUser,
			Key:  cfg.KOReaderKey,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Addr, "data_dir", cfg.DataDir)
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		stop()
		if !errors.Is(err, http.ErrServerClosed) {
			slog.Error("serve HTTP", "error", err)
			store.Close()
			os.Exit(1)
		}
		store.Close()
		return
	case <-ctx.Done():
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err = server.Shutdown(shutdownCtx)
	cancel()
	if err != nil {
		slog.Error("shut down HTTP server", "error", err)
		store.Close()
		os.Exit(1)
	}
	if err = <-errCh; !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve HTTP", "error", err)
		store.Close()
		os.Exit(1)
	}
	if err := store.Close(); err != nil {
		slog.Error("close database", "error", err)
		os.Exit(1)
	}
}
