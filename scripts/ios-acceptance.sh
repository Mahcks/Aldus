#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIG="$ROOT/scripts/ios-release.env"
[[ -f $CONFIG ]] && source "$CONFIG"
PORT=${ALDUS_ACCEPTANCE_PORT:-18082}
USERNAME=${ALDUS_ACCEPTANCE_USERNAME:-acceptance-admin}
PASSWORD=${ALDUS_ACCEPTANCE_PASSWORD:-aldus-acceptance-123}
WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/aldus-ios-acceptance.XXXXXX")
SERVER_PID=

fail() {
  echo "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

cleanup() {
  if [[ -n $SERVER_PID ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKSPACE"
}
trap cleanup EXIT INT TERM

[[ $(uname -s) == Darwin ]] || fail "iPhone acceptance must run on a Mac"
for command in bun curl go node security xcodebuild xcrun; do
  require_command "$command"
done
if [[ ! -f $ROOT/test-fixtures/alice/media/alice.epub || ! -f $ROOT/test-fixtures/alice/media/alice-chapter-01.mp3 ]]; then
  echo "Downloading the frozen Alice acceptance fixture..."
  "$ROOT/test-fixtures/alice/fetch.sh"
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
  DEVELOPMENT_TEAM=$(security find-identity -v -p codesigning 2>/dev/null | sed -nE 's/.*Apple (Development|Distribution): .*\(([A-Z0-9]{10})\)"/\2/p' | head -1)
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
echo "Fixture server: $SERVER_URL"
echo "Evidence: $ARTIFACT_DIR"

(
  cd "$ROOT/server"
  ALDUS_ENV=test go run ./cmd/seed-alice \
    --data-dir "$WORKSPACE/data" \
    --fixture-dir "$ROOT/test-fixtures/alice/media" \
    --artifact "$ROOT/test-fixtures/alice/automatic/hybrid-whisperx/alignment.json"
  go build -o "$WORKSPACE/aldus-server" ./cmd/app
)

ALDUS_ENV=test \
ALDUS_ADDR="0.0.0.0:$PORT" \
ALDUS_DATA_DIR="$WORKSPACE/data" \
ALDUS_BACKUP_DIR="$WORKSPACE/data/backups" \
"$WORKSPACE/aldus-server" >"$ARTIFACT_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in {1..80}; do
  kill -0 "$SERVER_PID" >/dev/null 2>&1 || fail "Fixture server exited; see $ARTIFACT_DIR/server.log"
  curl --fail --silent "http://127.0.0.1:$PORT/api/ready" >/dev/null && break
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:$PORT/api/ready" >/dev/null || fail "Fixture server did not become ready"

(
  cd "$ROOT/app"
  bun install --frozen-lockfile
  CI=1 bunx expo prebuild --platform ios --clean
)
node "$ROOT/scripts/configure-ios-acceptance.js" \
  "$ROOT/app/ios/Aldus.xcodeproj/project.pbxproj" \
  "$SERVER_URL" \
  "$USERNAME" \
  "$PASSWORD"

xcrun devicectl device uninstall app --device "$DEVICE" com.mahcks.aldus.acceptance >/dev/null 2>&1 || true

set -o pipefail
xcodebuild test \
  -workspace "$ROOT/app/ios/Aldus.xcworkspace" \
  -scheme AldusAcceptance \
  -configuration Release \
  -destination "platform=iOS,id=$DEVICE" \
  -derivedDataPath "$ARTIFACT_DIR/DerivedData" \
  -resultBundlePath "$ARTIFACT_DIR/AldusAcceptance.xcresult" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" | tee "$ARTIFACT_DIR/xcodebuild.log"

cat >"$ARTIFACT_DIR/summary.txt" <<EOF
Automated iPhone acceptance: PASS
Commit: $(git -C "$ROOT" rev-parse HEAD)
Device: $DEVICE
Server: $SERVER_URL

Automated:
- add server and bootstrap account
- download Alice for offline use
- open EPUB and navigate both directions
- background, terminate, relaunch, and reopen reader
- play/pause/seek/speed controls
- Read -> Listen -> Read and repeated switching
- account, server-switch, support, privacy, diagnostics, and deletion controls

Still manual:
- verify the visible passage is restored exactly
- hear audio, pitch, background playback, and lock-screen controls
- disconnect/reconnect the fixture server and verify offline progress reconciliation
- verify account/server data isolation
- quick smoke of the actual TestFlight binary
EOF

echo "Automated iPhone acceptance passed"
echo "Review $ARTIFACT_DIR/summary.txt and the screenshots in AldusAcceptance.xcresult"
