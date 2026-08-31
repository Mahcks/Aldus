#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# KOReader v2026.07.1/v2026.07.2 (the tags share this release commit).
KOREADER_REF=${KOREADER_REF:-9192014d8bd82a91dc1012473be0f238dedfdb54}
KOREADER_JOBS=${KOREADER_JOBS:-2}
SERVER_PORT=${ALDUS_ECOSYSTEM_PORT:-18083}
WEB_PORT=${ALDUS_ECOSYSTEM_WEB_PORT:-18084}
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

if [[ ${1:-} == self-test ]]; then
  [[ $KOREADER_REF =~ ^[0-9a-f]{40}$ ]]
  [[ $KOREADER_JOBS =~ ^[1-9][0-9]*$ ]]
  grep -q 'registerPatchPluginFunc("kosync"' "$ROOT/scripts/koreader-acceptance.lua"
  CHECK_FILE=$(mktemp "${TMPDIR:-/tmp}/aldus-ecosystem-check.XXXXXX")
  printf '%s\n' '{"progress":"xpointer","source_device":"web","revision":2}' >"$CHECK_FILE"
  [[ $(json_value "$CHECK_FILE" progress) == xpointer ]]
  [[ $(check_progress "$CHECK_FILE" web 1) == 2 ]]
  rm -f "$CHECK_FILE"
  "$ROOT/scripts/ios-acceptance.sh" self-test >/dev/null
  echo "Ecosystem acceptance checks passed"
  exit
fi

WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/aldus-ecosystem-acceptance.XXXXXX")
trap cleanup EXIT INT TERM

[[ $(uname -s) == Darwin ]] || fail "Ecosystem acceptance must run on the Mac connected to the iPhone"
for command in bun curl ffprobe git go node xcodebuild xcrun; do
  require_command "$command"
done
[[ $KOREADER_JOBS =~ ^[1-9][0-9]*$ ]] || fail "KOREADER_JOBS must be a positive integer"

if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX=$(brew --prefix)
  export PATH="$BREW_PREFIX/opt/findutils/libexec/gnubin:$BREW_PREFIX/opt/gnu-getopt/bin:$BREW_PREFIX/opt/make/libexec/gnubin:$BREW_PREFIX/opt/util-linux/bin:$PATH"
fi

KOREADER_DIR="$ROOT/.tools/koreader/$KOREADER_REF"
if [[ ! -d $KOREADER_DIR/.git ]]; then
  mkdir -p "$(dirname "$KOREADER_DIR")"
  git init -q "$KOREADER_DIR"
  git -C "$KOREADER_DIR" remote add origin https://github.com/koreader/koreader.git
fi
if ! git -C "$KOREADER_DIR" cat-file -e "$KOREADER_REF^{commit}" 2>/dev/null; then
  echo "Fetching pinned KOReader $KOREADER_REF..."
  git -C "$KOREADER_DIR" fetch --depth=1 origin "$KOREADER_REF"
fi
git -C "$KOREADER_DIR" checkout -q --detach "$KOREADER_REF"
if [[ ! -f $KOREADER_DIR/.aldus-emulator-built ]]; then
  echo "Building KOReader once with $KOREADER_JOBS jobs; later runs reuse this cache..."
  (cd "$KOREADER_DIR" && MAKEFLAGS="-j$KOREADER_JOBS" ./kodev build) || fail "KOReader build failed. Install its macOS prerequisites listed in docs/product-mvp-acceptance.md"
  touch "$KOREADER_DIR/.aldus-emulator-built"
fi

if [[ ! -f $ROOT/test-fixtures/alice/media/alice.epub || ! -f $ROOT/test-fixtures/alice/media/alice-chapter-01.mp3 ]]; then
  "$ROOT/test-fixtures/alice/fetch.sh"
fi
ffprobe -v error -show_entries format=duration -of json "$ROOT/test-fixtures/alice/media/alice-chapter-01.mp3" >/dev/null || fail "ffprobe could not read the Alice audio fixture"

INTERFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')
ADDRESS=$(ipconfig getifaddr "$INTERFACE" 2>/dev/null || true)
[[ -n $ADDRESS ]] || fail "Could not detect the Mac LAN address; set your active network as the default route"
LOCAL_SERVER="http://127.0.0.1:$SERVER_PORT"
IPHONE_SERVER="http://$ADDRESS:$SERVER_PORT"
WEB_URL="http://127.0.0.1:$WEB_PORT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SHORT_SHA=$(git -C "$ROOT" rev-parse --short=12 HEAD)
ARTIFACT_DIR="$ROOT/artifacts/ecosystem/$SHORT_SHA-$STAMP"
mkdir -p "$ARTIFACT_DIR" "$WORKSPACE/data"

echo "Evidence: $ARTIFACT_DIR"
echo "Fixture server: $LOCAL_SERVER (iPhone: $IPHONE_SERVER)"
echo "Clients run one at a time; KOReader is capped at $KOREADER_JOBS build jobs."

(
  cd "$ROOT/server"
  ALDUS_ENV=test go run ./cmd/seed-alice \
    --data-dir "$WORKSPACE/data" \
    --fixture-dir "$ROOT/test-fixtures/alice/media" \
    --artifact "$ROOT/test-fixtures/alice/automatic/hybrid-whisperx/alignment.json"
  go build -o "$WORKSPACE/aldus-server" ./cmd/app
)
ALDUS_ENV=test \
ALDUS_ADDR="0.0.0.0:$SERVER_PORT" \
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
  "$LOCAL_SERVER/api/v1/setup" >"$ARTIFACT_DIR/setup.json"
curl --fail --silent --show-error -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' --data '{"label":"Ecosystem KOReader"}' \
  "$LOCAL_SERVER/api/v1/me/reader-credentials" >"$WORKSPACE/credential.json"
READER_PASSWORD=$(json_value "$WORKSPACE/credential.json" secret)
READER_KEY=$(node -e 'process.stdout.write(require("crypto").createHash("md5").update(process.argv[1]).digest("hex"))' "$READER_PASSWORD")

curl --fail --silent --show-error -u "$USERNAME:$READER_PASSWORD" "$LOCAL_SERVER/opds/" >"$ARTIFACT_DIR/opds.xml"
grep -q "Alice's Adventures in Wonderland" "$ARTIFACT_DIR/opds.xml" || fail "Alice is missing from the OPDS catalog"
curl --fail --silent --show-error -u "$USERNAME:$READER_PASSWORD" \
  "$LOCAL_SERVER/opds/media/$MEDIA_ID" >"$WORKSPACE/alice.epub"
[[ $(shasum -a 256 "$WORKSPACE/alice.epub" | awk '{print $1}') == 6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c ]] || fail "OPDS changed the frozen Alice EPUB"

(
  cd "$ROOT/app"
  bun install --frozen-lockfile
)

run_web_phase() {
  local phase=$1
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
  (
    cd "$KOREADER_DIR"
    KO_HOME="$WORKSPACE/koreader-home" \
    ALDUS_KOREADER_MODE="$mode" \
    ALDUS_KOREADER_OUTPUT="$ARTIFACT_DIR/koreader-$mode.txt" \
    ALDUS_KOREADER_EXPECTED="$expected" \
    ALDUS_KOREADER_SCREENSHOT="$ARTIFACT_DIR/koreader-$mode.png" \
    ALDUS_KOREADER_SERVER="$LOCAL_SERVER" \
    ALDUS_KOREADER_USERNAME="$USERNAME" \
    ALDUS_KOREADER_PASSWORD="$READER_PASSWORD" \
    ./kodev run --no-build "$WORKSPACE/alice.epub"
  ) >"$ARTIFACT_DIR/koreader-$mode.log" 2>&1 || fail "KOReader $mode failed; see $ARTIFACT_DIR/koreader-$mode.log"
  grep -q '^status=pass$' "$ARTIFACT_DIR/koreader-$mode.txt" || fail "KOReader $mode did not report success"
}

REVISION=0
run_web_phase seed
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-web-seed.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-web-seed.json" web "$REVISION")

run_koreader advance
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-koreader.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-koreader.json" koreader "$REVISION")

ALDUS_ACCEPTANCE_EXTERNAL_SERVER=1 \
ALDUS_ACCEPTANCE_SERVER="$IPHONE_SERVER" \
ALDUS_ACCEPTANCE_USERNAME="$USERNAME" \
ALDUS_ACCEPTANCE_PASSWORD="$PASSWORD" \
ALDUS_ACCEPTANCE_ONLY_TEST=testEcosystemHandoff \
ALDUS_ACCEPTANCE_ARTIFACT_DIR="$ARTIFACT_DIR/ios" \
"$ROOT/scripts/ios-acceptance.sh"
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-ios.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-ios.json" ios "$REVISION")

run_koreader verify
run_web_phase verify
curl --fail --silent --show-error -b "$COOKIE_JAR" "$LOCAL_SERVER/api/v1/works/$WORK_ID/progress" >"$ARTIFACT_DIR/progress-web-final.json"
REVISION=$(check_progress "$ARTIFACT_DIR/progress-web-final.json" web "$REVISION")

cat >"$ARTIFACT_DIR/summary.txt" <<EOF
Ecosystem acceptance: PASS
Commit: $(git -C "$ROOT" rev-parse HEAD)
Final revision: $REVISION
KOReader commit: $KOREADER_REF

Verified sequentially:
- reader credential authenticates OPDS and downloads the byte-identical EPUB
- Aldus web renders Alice and writes canonical progress
- real KOReader pulls that XPointer, renders it, advances, and pushes a new XPointer
- physical iPhone restores the KOReader position, advances, and writes canonical progress
- real KOReader pulls and renders the iPhone position
- Aldus web restores the iPhone position and advances again
EOF

echo "Web ↔ KOReader ↔ iPhone ecosystem acceptance passed"
echo "Review $ARTIFACT_DIR/summary.txt and its screenshots/logs"
