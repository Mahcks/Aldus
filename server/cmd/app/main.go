package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mahcks/aldus/server/internal/api"
	"github.com/mahcks/aldus/server/internal/config"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	cfg := config.Load()
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Handler(os.DirFS("public")),
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
			os.Exit(1)
		}
		return
	case <-ctx.Done():
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err := server.Shutdown(shutdownCtx)
	cancel()
	if err != nil {
		slog.Error("shut down HTTP server", "error", err)
		os.Exit(1)
	}
	if err = <-errCh; !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve HTTP", "error", err)
		os.Exit(1)
	}
}
