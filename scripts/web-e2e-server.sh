#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=$(mktemp -d "${TMPDIR:-/tmp}/aldus-web-e2e.XXXXXX")
SERVER_PID=

cleanup() {
  [[ -z $SERVER_PID ]] || kill "$SERVER_PID" >/dev/null 2>&1 || true
  [[ -z $SERVER_PID ]] || wait "$SERVER_PID" >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM

cd "$ROOT/server"
ALDUS_ENV=test go run ./cmd/seed-alice \
  --data-dir "$DATA" \
  --fixture-dir "$ROOT/test-fixtures/alice/media" \
  --artifact "$ROOT/test-fixtures/alice/automatic/hybrid-whisperx/alignment.json"

ALDUS_ENV=test \
ALDUS_ADDR=127.0.0.1:18080 \
ALDUS_DATA_DIR="$DATA" \
ALDUS_BACKUP_DIR="$DATA/backups" \
ALDUS_ALLOWED_ORIGINS=http://127.0.0.1:18081 \
go run ./cmd/app &
SERVER_PID=$!
wait "$SERVER_PID"
