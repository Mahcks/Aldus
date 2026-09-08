#!/usr/bin/env bash
# Local public-domain fixture only; no internet-facing NNTP server or credentials.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=$(mktemp -d /tmp/aldus-usenet-smoke.XXXXXX)
NAME="aldus-usenet-smoke-$$"
IMAGE="lscr.io/linuxserver/sabnzbd@sha256:64c4c2b6ed546237451cbfec33aa8bac1396865c1a266dd247c02b36ffe27c62"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM
mkdir -p "$DATA/config" "$DATA/downloads" "$DATA/fixture"
cp "$ROOT/test-fixtures/alice/media/alice.epub" "$DATA/fixture/alice.epub"
cp "$ROOT/scripts/fixtures/local-nntp.py" "$DATA/fixture/server.py"
cat > "$DATA/config/sabnzbd.ini" <<'INI'
[misc]
host = 0.0.0.0
port = 8080
api_key = 0123456789abcdef0123456789abcdef
nzb_key = abcdef0123456789abcdef0123456789
download_dir = /downloads/incomplete
complete_dir = /downloads/complete
inet_exposure = 5
check_new_rel = 0
enable_https_verification = 1
[servers]
[[local-fixture]]
name = local-fixture
host = 127.0.0.1
port = 1119
connections = 1
ssl = 0
enable = 1
optional = 0
retention = 0
INI
PORT=$(python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    print(listener.getsockname()[1])
PY
)
docker network create "$NAME" >/dev/null
docker run -d --name "$NAME" --network "$NAME" -p "127.0.0.1:$PORT:8080" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" \
  -v "$DATA/config:/config" -v "$DATA/downloads:/downloads" -v "$DATA/fixture:/fixture:ro" "$IMAGE" >/dev/null
docker exec -d "$NAME" python3 /fixture/server.py
export ALDUS_USENET_SMOKE_URL="http://127.0.0.1:$PORT"
export ALDUS_USENET_SMOKE_DATA="$DATA/downloads"
export ALDUS_USENET_SMOKE_CONTAINER="$NAME"
cd "$ROOT/server"
if ! go test ./internal/acquisition -run '^TestDisposableUsenetSmoke$' -count=1 -v; then
  docker logs --tail 80 "$NAME"
  exit 1
fi
