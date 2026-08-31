#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
KOREADER_VERSION=2026.07.1
KOREADER_ARCHIVE_SHA256=299aadb28147a25e9432ced1214ea444a4184393b5ae97cf42402c8a61b1a1b0
KOREADER_ARCHIVE_URL="https://github.com/koreader/koreader/releases/download/v$KOREADER_VERSION/koreader-linux-x86_64-v$KOREADER_VERSION.tar.xz"
SERVER_PORT=${ALDUS_ECOSYSTEM_PORT:-18083}
WEB_PORT=${ALDUS_ECOSYSTEM_WEB_PORT:-18084}
WITH_IPHONE=${ALDUS_ECOSYSTEM_IPHONE:-0}
IPHONE_WAIT_SECONDS=${ALDUS_ECOSYSTEM_IPHONE_WAIT_SECONDS:-1800}
USERNAME=ecosystem-admin
PASSWORD=aldus-ecosystem-123
WORK_ID=alice-gutenberg-11-work
MEDIA_ID=alice-gutenberg-11-epub-media
DOCUMENT_ID=abb11be65399f96116fd90ab861dda0e
WORKSPACE=
SERVER_PID=
WEB_PID=

fail() {
  echo "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

cleanup() {
  stop_web
  if [[ -n $SERVER_PID ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  [[ -z $WORKSPACE ]] || rm -rf "$WORKSPACE"
}

stop_web() {
  if [[ -n $WEB_PID ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
    wait "$WEB_PID" >/dev/null 2>&1 || true
    WEB_PID=
  fi
}

wait_for() {
  local url=$1
  local pid=$2
  local log=$3
  for _ in {1..240}; do
    kill -0 "$pid" >/dev/null 2>&1 || fail "Process exited; see $log"
    curl --fail --silent "$url" >/dev/null && return
    sleep 0.25
  done
  fail "Timed out waiting for $url; see $log"
}

json_value() {
  node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const result=value[process.argv[2]]; if (result === undefined || result === null || result === "") process.exit(1); process.stdout.write(String(result));' "$1" "$2"
}

check_progress() {
  node - "$1" "$2" "$3" <<'NODE'
const fs = require('fs');
const [file, source, previous] = process.argv.slice(2);
const progress = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!progress.source_device?.startsWith(source)) throw new Error(`source ${progress.source_device} does not start with ${source}`);
if (!Number.isInteger(progress.revision) || progress.revision <= Number(previous)) throw new Error(`revision ${progress.revision} did not advance past ${previous}`);
process.stdout.write(String(progress.revision));
NODE
}

wait_for_progress_source() {
  local source=$1
  local previous=$2
  local output=$3
  local elapsed
  for ((elapsed = 0; elapsed < IPHONE_WAIT_SECONDS; elapsed += 2)); do
    curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$output" || true
    if check_progress "$output" "$source" "$previous" >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  fail "Timed out waiting for $source progress after $IPHONE_WAIT_SECONDS seconds"
}

if [[ ${1:-} == self-test ]]; then
  [[ $KOREADER_ARCHIVE_SHA256 =~ ^[0-9a-f]{64}$ ]]
  [[ $WITH_IPHONE == 0 || $WITH_IPHONE == 1 ]]
  [[ $IPHONE_WAIT_SECONDS =~ ^[1-9][0-9]*$ ]]
  grep -q 'registerPatchPluginFunc("kosync"' "$ROOT/scripts/koreader-acceptance.lua"
  CHECK_FILE=$(mktemp "${TMPDIR:-/tmp}/aldus-ecosystem-check.XXXXXX")
  printf '%s\n' '{"progress":"xpointer","source_device":"web","revision":2}' >"$CHECK_FILE"
  [[ $(json_value "$CHECK_FILE" progress) == xpointer ]]
  [[ $(check_progress "$CHECK_FILE" web 1) == 2 ]]
  rm -f "$CHECK_FILE"
  echo "KOReader acceptance checks passed"
  exit
fi

[[ $(uname -s) == Linux ]] || fail "Real KOReader acceptance runs in GitHub CI; run make ios-acceptance on this Mac"
for command in bun curl ffprobe go node sha256sum tar; do
  require_command "$command"
done
[[ $WITH_IPHONE == 0 || $WITH_IPHONE == 1 ]] || fail "ALDUS_ECOSYSTEM_IPHONE must be 0 or 1"
[[ $IPHONE_WAIT_SECONDS =~ ^[1-9][0-9]*$ ]] || fail "ALDUS_ECOSYSTEM_IPHONE_WAIT_SECONDS must be a positive integer"

WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/aldus-ecosystem-acceptance.XXXXXX")
trap cleanup EXIT INT TERM
LOCAL_SERVER="http://127.0.0.1:$SERVER_PORT"
WEB_URL="http://127.0.0.1:$WEB_PORT"
SERVER_BIND=127.0.0.1
IPHONE_SERVER=
if [[ $WITH_IPHONE == 1 ]]; then
  require_command ip
  LAN_ADDRESS=${ALDUS_ECOSYSTEM_LAN_ADDRESS:-$(ip -4 route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i=="src") {print $(i+1); exit}}')}
  [[ -n $LAN_ADDRESS ]] || fail "Could not detect the Linux LAN address; set ALDUS_ECOSYSTEM_LAN_ADDRESS"
  SERVER_BIND=0.0.0.0
  IPHONE_SERVER="http://$LAN_ADDRESS:$SERVER_PORT"
fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SHORT_SHA=$(git -C "$ROOT" rev-parse --short=12 HEAD)
ARTIFACT_DIR="$ROOT/artifacts/ecosystem/$SHORT_SHA-$STAMP"
mkdir -p "$ARTIFACT_DIR" "$WORKSPACE/data" "$WORKSPACE/koreader"

echo "Downloading pinned KOReader v$KOREADER_VERSION on the Linux acceptance host..."
curl --location --fail --silent --show-error --output "$WORKSPACE/koreader.tar.xz" "$KOREADER_ARCHIVE_URL"
echo "$KOREADER_ARCHIVE_SHA256  $WORKSPACE/koreader.tar.xz" | sha256sum --check --status || fail "KOReader release archive checksum mismatch"
tar -xJf "$WORKSPACE/koreader.tar.xz" -C "$WORKSPACE/koreader"

if [[ ! -f $ROOT/test-fixtures/alice/media/alice.epub || ! -f $ROOT/test-fixtures/alice/media/alice-chapter-01.mp3 ]]; then
  "$ROOT/test-fixtures/alice/fetch.sh"
fi
ffprobe -v error -show_entries format=duration -of json "$ROOT/test-fixtures/alice/media/alice-chapter-01.mp3" >/dev/null || fail "ffprobe could not read the Alice audio fixture"

echo "Evidence: $ARTIFACT_DIR"
echo "Fixture server: $LOCAL_SERVER"
[[ -z $IPHONE_SERVER ]] || echo "iPhone fixture server: $IPHONE_SERVER"

(
  cd "$ROOT/server"
  ALDUS_ENV=test go run ./cmd/seed-alice \
    --data-dir "$WORKSPACE/data" \
    --fixture-dir "$ROOT/test-fixtures/alice/media" \
    --artifact "$ROOT/test-fixtures/alice/automatic/hybrid-whisperx/alignment.json"
  go build -o "$WORKSPACE/aldus-server" ./cmd/app
)
ALDUS_ENV=test \
ALDUS_ADDR="$SERVER_BIND:$SERVER_PORT" \
ALDUS_DATA_DIR="$WORKSPACE/data" \
ALDUS_BACKUP_DIR="$WORKSPACE/data/backups" \
ALDUS_ALLOWED_ORIGINS="$WEB_URL" \
"$WORKSPACE/aldus-server" >"$ARTIFACT_DIR/server.log" 2>&1 &
SERVER_PID=$!
wait_for "$LOCAL_SERVER/api/ready" "$SERVER_PID" "$ARTIFACT_DIR/server.log"

COOKIE_JAR="$WORKSPACE/session.cookies"
curl --fail --silent --show-error -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  --data '{"username":"ecosystem-admin","display_name":"Ecosystem Admin","password":"aldus-ecosystem-123","password_confirmation":"aldus-ecosystem-123"}' \
  "$LOCAL_SERVER/api/v1/setup" >"$WORKSPACE/setup.json"
curl --fail --silent --show-error -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' --data '{"label":"Ecosystem KOReader"}' \
  "$LOCAL_SERVER/api/v1/me/reader-credentials" >"$WORKSPACE/credential.json"
READER_PASSWORD=$(json_value "$WORKSPACE/credential.json" secret)
READER_KEY=$(node -e 'process.stdout.write(require("crypto").createHash("md5").update(process.argv[1]).digest("hex"))' "$READER_PASSWORD")

curl --fail --silent --show-error -u "$USERNAME:$READER_PASSWORD" "$LOCAL_SERVER/opds/" >"$ARTIFACT_DIR/opds.xml"
grep -q 'Adventures in Wonderland' "$ARTIFACT_DIR/opds.xml" || fail "Alice is missing from the OPDS catalog"
curl --fail --silent --show-error -u "$USERNAME:$READER_PASSWORD" \
  "$LOCAL_SERVER/opds/media/$MEDIA_ID" >"$WORKSPACE/alice.epub"
echo "6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c  $WORKSPACE/alice.epub" | sha256sum --check --status || fail "OPDS changed the frozen Alice EPUB"

(
  cd "$ROOT/app"
  bun install --frozen-lockfile
)

run_web_phase() {
  local phase=$1
  local resume_label=${2:-Resumed from KOReader}
  (cd "$ROOT/app" && exec env CI=1 EXPO_PUBLIC_WEB_API_URL="$LOCAL_SERVER" bunx expo start --web --port "$WEB_PORT") >"$ARTIFACT_DIR/web-$phase.log" 2>&1 &
  WEB_PID=$!
  wait_for "$WEB_URL" "$WEB_PID" "$ARTIFACT_DIR/web-$phase.log"
  (
    cd "$ROOT/app"
    ALDUS_ECOSYSTEM_SERVER="$LOCAL_SERVER" \
    ALDUS_ECOSYSTEM_WEB_URL="$WEB_URL" \
    ALDUS_ECOSYSTEM_USERNAME="$USERNAME" \
    ALDUS_ECOSYSTEM_PASSWORD="$PASSWORD" \
    ALDUS_ECOSYSTEM_PHASE="$phase" \
    ALDUS_ECOSYSTEM_RESUME_LABEL="$resume_label" \
    ALDUS_ECOSYSTEM_SCREENSHOT="$ARTIFACT_DIR/web-$phase.png" \
    bunx playwright test e2e/ecosystem.e2e.ts --project=chromium --workers=1
  )
  stop_web
}

run_koreader() {
  local mode=$1
  local expected_file="$ARTIFACT_DIR/koreader-$mode-expected.json"
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.koreader.v1+json' \
    -H "x-auth-user: $USERNAME" -H "x-auth-key: $READER_KEY" \
    "$LOCAL_SERVER/syncs/progress/$DOCUMENT_ID" >"$expected_file"
  local expected
  expected=$(json_value "$expected_file" progress)
  mkdir -p "$WORKSPACE/koreader-home/patches"
  cp "$ROOT/scripts/koreader-acceptance.lua" "$WORKSPACE/koreader-home/patches/2-ecosystem.lua"
  KO_HOME="$WORKSPACE/koreader-home" \
  ALDUS_KOREADER_MODE="$mode" \
  ALDUS_KOREADER_OUTPUT="$ARTIFACT_DIR/koreader-$mode.txt" \
  ALDUS_KOREADER_EXPECTED="$expected" \
  ALDUS_KOREADER_SCREENSHOT="$ARTIFACT_DIR/koreader-$mode.png" \
  ALDUS_KOREADER_SERVER="$LOCAL_SERVER" \
  ALDUS_KOREADER_USERNAME="$USERNAME" \
  ALDUS_KOREADER_PASSWORD="$READER_PASSWORD" \
  SDL_VIDEODRIVER=dummy "$WORKSPACE/koreader/bin/koreader" "$WORKSPACE/alice.epub" \
    >"$ARTIFACT_DIR/koreader-$mode.log" 2>&1 || fail "KOReader $mode failed; see $ARTIFACT_DIR/koreader-$mode.log"
  grep -q '^status=pass$' "$ARTIFACT_DIR/koreader-$mode.txt" || fail "KOReader $mode did not report success"
}

REVISION=0
run_web_phase seed
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-web-seed.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-web-seed.json" web "$REVISION")

run_koreader advance
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-koreader.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-koreader.json" koreader "$REVISION")

if [[ $WITH_IPHONE == 1 ]]; then
  cat <<EOF

KOReader restored Web progress and advanced it. On the Mac, from the same commit, run:

ALDUS_ACCEPTANCE_EXTERNAL_SERVER=1 \\
ALDUS_ACCEPTANCE_SERVER=$IPHONE_SERVER \\
ALDUS_ACCEPTANCE_USERNAME=$USERNAME \\
ALDUS_ACCEPTANCE_PASSWORD=$PASSWORD \\
ALDUS_ACCEPTANCE_ONLY_TEST=testEcosystemHandoff \\
make ios-acceptance

Waiting up to $((IPHONE_WAIT_SECONDS / 60)) minutes for the physical iPhone handoff...
EOF
  wait_for_progress_source ios-acceptance-complete "$REVISION" "$ARTIFACT_DIR/progress-ios.json"
  REVISION=$(check_progress "$ARTIFACT_DIR/progress-ios.json" ios-acceptance-complete "$REVISION")
  echo "Physical iPhone progress received at revision $REVISION"
  run_koreader verify
  run_web_phase verify "Resumed from Aldus on iOS"
else
  run_web_phase verify
fi
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-web-final.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-web-final.json" web "$REVISION")
[[ $WITH_IPHONE == 1 ]] || run_koreader verify

cat >"$ARTIFACT_DIR/summary.txt" <<EOF
Ecosystem acceptance: PASS
Commit: $(git -C "$ROOT" rev-parse HEAD)
Final revision: $REVISION
KOReader release: v$KOREADER_VERSION

Verified sequentially:
- reader credential authenticates OPDS and downloads the byte-identical EPUB
- Aldus Web renders Alice and writes canonical progress
- real KOReader pulls that XPointer, renders it, advances, and pushes a new XPointer
EOF

if [[ $WITH_IPHONE == 1 ]]; then
  cat >>"$ARTIFACT_DIR/summary.txt" <<EOF
- physical iPhone restores the KOReader position, advances, and writes canonical progress
- real KOReader pulls and renders the iPhone position
- Aldus Web restores the iPhone position and advances again
EOF
  echo "Web ↔ real KOReader ↔ physical iPhone ecosystem acceptance passed"
else
  cat >>"$ARTIFACT_DIR/summary.txt" <<EOF
- Aldus Web restores the KOReader position and advances again
- real KOReader pulls and renders the final Web position
EOF
  echo "Web ↔ real KOReader acceptance passed"
fi
