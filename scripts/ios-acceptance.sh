#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIG="$ROOT/scripts/ios-release.env"
[[ -f $CONFIG ]] && source "$CONFIG"
PORT=${ALDUS_ACCEPTANCE_PORT:-18082}
UPSTREAM_PORT=${ALDUS_ACCEPTANCE_UPSTREAM_PORT:-18081}
USERNAME=${ALDUS_ACCEPTANCE_USERNAME:-acceptance-admin}
PASSWORD=${ALDUS_ACCEPTANCE_PASSWORD:-aldus-acceptance-123}
EXTERNAL_SERVER=${ALDUS_ACCEPTANCE_EXTERNAL_SERVER:-0}
WORKSPACE=
SERVER_PID=
PROXY_PID=
PACKAGE_JSON_BACKUP=

fail() {
  echo "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

team_id_from_subject() {
  sed -nE 's/.*(^|,)OU=([A-Z0-9]{10})(,|$).*/\2/p'
}

mark_ecosystem_complete() {
  local cookie="$WORKSPACE/ecosystem.cookies"
  local progress="$WORKSPACE/ecosystem-progress.json"
  local body
  curl --fail --silent --show-error -c "$cookie" \
    -H 'Content-Type: application/json' \
    --data "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
    "$SERVER_URL/api/v1/auth/login" >/dev/null
  for _ in 1 2 3; do
    curl --fail --silent --show-error -b "$cookie" \
      "$SERVER_URL/api/v1/works/alice-gutenberg-11-work/progress" >"$progress"
    body=$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(JSON.stringify({alignment_id:p.alignment_id,segment_id:p.segment_id,offset:p.offset,expected_revision:p.revision,source_device:"ios-acceptance-complete"}))' "$progress")
    if curl --fail --silent --show-error -b "$cookie" \
      -H 'Content-Type: application/json' -X PUT --data "$body" \
      "$SERVER_URL/api/v1/works/alice-gutenberg-11-work/progress" >"$ARTIFACT_DIR/ecosystem-complete.json"; then
      return
    fi
  done
  fail "Could not mark the completed iPhone ecosystem handoff"
}

if [[ ${1:-} == self-test ]]; then
  [[ $(printf '%s\n' 'subject=UID=person,CN=Apple Development: Person (CERTID1234),OU=TEAMID1234,O=Person,C=US' | team_id_from_subject) == TEAMID1234 ]]
  echo "iOS acceptance checks passed"
  exit
fi

cleanup() {
  if [[ -n $PACKAGE_JSON_BACKUP && -f $PACKAGE_JSON_BACKUP ]]; then
    cp "$PACKAGE_JSON_BACKUP" "$ROOT/app/package.json"
  fi
  if [[ -n $PROXY_PID ]]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
    wait "$PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n $SERVER_PID ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  [[ -z $WORKSPACE ]] || rm -rf "$WORKSPACE"
}
WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/aldus-ios-acceptance.XXXXXX")
trap cleanup EXIT INT TERM

[[ $(uname -s) == Darwin ]] || fail "iPhone acceptance must run on a Mac"
for command in bun curl node openssl security xcodebuild xcrun; do
  require_command "$command"
done
if [[ $EXTERNAL_SERVER != 1 ]]; then
  require_command ffprobe
  require_command go
  if [[ ! -f $ROOT/test-fixtures/alice/media/alice.epub || ! -f $ROOT/test-fixtures/alice/media/alice-chapter-01.mp3 ]]; then
    echo "Downloading the frozen Alice acceptance fixture..."
    "$ROOT/test-fixtures/alice/fetch.sh"
  fi
  ffprobe -v error -show_entries format=duration -of json \
    "$ROOT/test-fixtures/alice/media/alice-chapter-01.mp3" >/dev/null || \
    fail "ffprobe could not read the Alice audio fixture"
fi

DEVICE=${DEVICE:-}
if [[ -z $DEVICE ]]; then
  DEVICES=$(xcrun xctrace list devices 2>/dev/null | sed -nE '/^== Simulators ==/q; /iPhone/ s/.*\(([0-9A-Fa-f-]{20,})\)$/\1/p')
  DEVICE_COUNT=$(printf '%s\n' "$DEVICES" | awk 'NF{count++} END{print count+0}')
  [[ $DEVICE_COUNT -le 1 ]] || fail "More than one iPhone is connected; rerun with DEVICE=<udid>"
  DEVICE=$DEVICES
fi
[[ -n $DEVICE ]] || fail "Connect an unlocked iPhone with Developer Mode enabled, or set DEVICE=<udid>"

DEVELOPMENT_TEAM=${IOS_DEVELOPMENT_TEAM:-}
if [[ -z $DEVELOPMENT_TEAM ]]; then
  DEVELOPMENT_IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | sed -nE 's/.*"(Apple Development: [^"]+)".*/\1/p' | head -1)
  if [[ -n $DEVELOPMENT_IDENTITY ]]; then
    DEVELOPMENT_TEAM=$(security find-certificate -p -c "$DEVELOPMENT_IDENTITY" | openssl x509 -noout -subject -nameopt RFC2253 | team_id_from_subject)
  fi
fi
[[ -n $DEVELOPMENT_TEAM ]] || fail "Set IOS_DEVELOPMENT_TEAM=<10-character Apple team ID>; Xcode needs an Apple Development signing identity"

if [[ -n ${ALDUS_ACCEPTANCE_SERVER:-} ]]; then
  SERVER_URL=${ALDUS_ACCEPTANCE_SERVER%/}
else
  INTERFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')
  ADDRESS=$(ipconfig getifaddr "$INTERFACE" 2>/dev/null || true)
  [[ -n $ADDRESS ]] || fail "Could not detect the Mac LAN address; set ALDUS_ACCEPTANCE_SERVER=http://<mac-ip>:$PORT"
  SERVER_URL="http://$ADDRESS:$PORT"
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SHORT_SHA=$(git -C "$ROOT" rev-parse --short=12 HEAD)
ARTIFACT_DIR="$ROOT/artifacts/ios/acceptance-$SHORT_SHA-$STAMP"
mkdir -p "$ARTIFACT_DIR"

echo "Acceptance app: com.mahcks.aldus.acceptance (your TestFlight app is untouched)"
echo "iPhone: $DEVICE"
echo "Signing team: $DEVELOPMENT_TEAM"
echo "Fixture server: $SERVER_URL"
echo "Evidence: $ARTIFACT_DIR"

if [[ $EXTERNAL_SERVER == 1 ]]; then
  curl --fail --silent "$SERVER_URL/api/ready" >/dev/null || fail "External fixture server is not ready at $SERVER_URL"
else
  mkdir -p "$WORKSPACE/data"
  (
    cd "$ROOT/server"
    ALDUS_ENV=test go run ./cmd/seed-alice \
      --data-dir "$WORKSPACE/data" \
      --fixture-dir "$ROOT/test-fixtures/alice/media" \
      --artifact "$ROOT/test-fixtures/alice/automatic/hybrid-whisperx/alignment.json"
    go build -o "$WORKSPACE/aldus-server" ./cmd/app
    go build -o "$WORKSPACE/ios-acceptance-proxy" "$ROOT/scripts/ios-acceptance-proxy.go"
  )

  ALDUS_ENV=test \
  ALDUS_ADDR="127.0.0.1:$UPSTREAM_PORT" \
  ALDUS_DATA_DIR="$WORKSPACE/data" \
  ALDUS_BACKUP_DIR="$WORKSPACE/data/backups" \
  "$WORKSPACE/aldus-server" >"$ARTIFACT_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  "$WORKSPACE/ios-acceptance-proxy" \
    -listen "0.0.0.0:$PORT" \
    -upstream "http://127.0.0.1:$UPSTREAM_PORT" \
    >"$ARTIFACT_DIR/proxy.log" 2>&1 &
  PROXY_PID=$!

  for _ in {1..80}; do
    kill -0 "$SERVER_PID" >/dev/null 2>&1 || fail "Fixture server exited; see $ARTIFACT_DIR/server.log"
    kill -0 "$PROXY_PID" >/dev/null 2>&1 || fail "Acceptance proxy exited; see $ARTIFACT_DIR/proxy.log"
    curl --fail --silent "http://127.0.0.1:$PORT/api/ready" >/dev/null && break
    sleep 0.25
  done
  curl --fail --silent "http://127.0.0.1:$PORT/api/ready" >/dev/null || fail "Fixture server did not become ready"
fi

PACKAGE_JSON_BACKUP="$WORKSPACE/package.json"
cp "$ROOT/app/package.json" "$PACKAGE_JSON_BACKUP"
(
  cd "$ROOT/app"
  bun install --frozen-lockfile
  CI=1 bunx expo prebuild --platform ios --clean
)
cp "$WORKSPACE/package.json" "$ROOT/app/package.json"
PACKAGE_JSON_BACKUP=
node "$ROOT/scripts/configure-ios-acceptance.js" \
  "$ROOT/app/ios/Aldus.xcodeproj/project.pbxproj" \
  "$SERVER_URL" \
  "$USERNAME" \
  "$PASSWORD" \
  "$([[ $EXTERNAL_SERVER == 1 ]] && echo 0 || echo 1)"

xcrun devicectl device uninstall app --device "$DEVICE" com.mahcks.aldus.acceptance >/dev/null 2>&1 || true

set -o pipefail
run_xcodebuild() {
  xcodebuild test \
    -workspace "$ROOT/app/ios/Aldus.xcworkspace" \
    -scheme AldusAcceptance \
    -configuration Release \
    -destination "platform=iOS,id=$DEVICE" \
    -derivedDataPath "$ARTIFACT_DIR/DerivedData" \
    -resultBundlePath "$ARTIFACT_DIR/AldusAcceptance.xcresult" \
    "$@" \
    -collect-test-diagnostics never \
    -allowProvisioningUpdates \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" 2>&1 | tee "$ARTIFACT_DIR/xcodebuild.log"
}
SELECTED_TEST=${ALDUS_ACCEPTANCE_ONLY_TEST:-testReaderAcceptance}
if ! run_xcodebuild "-only-testing:AldusUITests/AldusUITests/$SELECTED_TEST"; then
  if grep -q 'Not authorized for performing UI testing actions' "$ARTIFACT_DIR/xcodebuild.log"; then
    fail "iPhone UI automation was revoked. Unlock the iPhone, accept any trust or automation prompt, keep it unlocked, and rerun make ios-acceptance."
  fi
  fail "iPhone acceptance failed; see $ARTIFACT_DIR/xcodebuild.log"
fi
[[ -d $ARTIFACT_DIR/AldusAcceptance.xcresult ]] || fail "xcodebuild did not produce a test result bundle"

if [[ $EXTERNAL_SERVER == 1 && ${ALDUS_ACCEPTANCE_ONLY_TEST:-} == testEcosystemHandoff ]]; then
  mark_ecosystem_complete
fi

if [[ -n ${ALDUS_ACCEPTANCE_ONLY_TEST:-} ]]; then
  cat >"$ARTIFACT_DIR/summary.txt" <<EOF
Automated iPhone ecosystem handoff: PASS
Commit: $(git -C "$ROOT" rev-parse HEAD)
Device: $DEVICE
Server: $SERVER_URL
Test: $ALDUS_ACCEPTANCE_ONLY_TEST

Verified:
- sign in to the shared fixture server
- restore canonical progress written by KOReader
- advance the native EPUB and bridge Read → Listen → Read
EOF
else
  cat >"$ARTIFACT_DIR/summary.txt" <<EOF
Automated iPhone acceptance: PASS
Commit: $(git -C "$ROOT" rev-parse HEAD)
Device: $DEVICE
Server: $SERVER_URL

Automated:
- add server and bootstrap account
- download Alice for offline use
- disconnect the fixture server, read offline, relaunch, reconnect, and sync progress
- open EPUB and navigate both directions
- background, terminate, relaunch, and reopen reader
- play/pause/seek/speed controls
- Read -> Listen -> Read and repeated switching
- account, server-switch, support, privacy, diagnostics, and deletion controls

Still manual:
- verify the visible passage is restored exactly
- hear audio, pitch, background playback, and lock-screen controls
- verify account/server data isolation
- quick smoke of the actual TestFlight binary
EOF
fi

echo "Automated iPhone acceptance passed"
echo "Review $ARTIFACT_DIR/summary.txt and the screenshots in AldusAcceptance.xcresult"
