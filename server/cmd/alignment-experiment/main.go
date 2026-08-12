package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
)

func main() {
	if len(os.Args) < 2 {
		slog.Error("usage: go run ./cmd/alignment-experiment <convert|evaluate> [worker options]")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	command := exec.CommandContext(ctx, "python3", append([]string{"../tools/alignment.py"}, os.Args[1:]...)...)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil && !errors.Is(ctx.Err(), context.Canceled) {
		slog.Error("alignment worker failed", "error", err)
		os.Exit(1)
	}
}
