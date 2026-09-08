#!/usr/bin/env bash
# Disposable qBittorrent only. Does not accept a remote URL or production credentials.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=$(mktemp -d /tmp/aldus-seeding-smoke.XXXXXX)
NAME="aldus-seeding-smoke-$$"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  docker image rm "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM
mkdir -p "$DATA/config/qBittorrent/config" "$DATA/downloads"
python3 - "$DATA/config/qBittorrent/config/qBittorrent.conf" <<'PY'
import base64, hashlib, sys
salt = b"aldus-disposable-smoke"
password = b"aldus-smoke-only"
hashed = hashlib.pbkdf2_hmac("sha512", password, salt, 100000)
with open(sys.argv[1], "w") as f:
    f.write("[BitTorrent]\nSession\\DHTEnabled=false\nSession\\PeXEnabled=false\nSession\\LSDEnabled=false\n[Preferences]\n")
    f.write("WebUI\\Username=admin\n")
    f.write('WebUI\\Password_PBKDF2="@ByteArray(%s:%s)"\n' % (
        base64.b64encode(salt).decode(), base64.b64encode(hashed).decode()))
    f.write("WebUI\\HostHeaderValidation=false\n")
    f.write("Downloads\\SavePath=/downloads/\n")
PY
docker build -q -t "$NAME" - <<'DOCKER'
FROM alpine:3.23
RUN apk add --no-cache qbittorrent-nox
ENTRYPOINT ["qbittorrent-nox","--confirm-legal-notice","--profile=/config","--webui-port=8080"]
DOCKER
docker network create "$NAME" >/dev/null
# An explicit ephemeral host port remains stable across container restarts.
PORT=$(python3 - <<'PORTPY'
import socket
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    print(listener.getsockname()[1])
PORTPY
)
docker run -d --user "$(id -u):$(id -g)" --name "$NAME" --network "$NAME" -p "127.0.0.1:$PORT:8080"   -v "$DATA/config:/config" -v "$DATA/downloads:/downloads" "$NAME" >/dev/null
PORT=$(docker port "$NAME" 8080/tcp | cut -d: -f2)
export ALDUS_SEEDING_SMOKE_URL="http://127.0.0.1:$PORT"
export ALDUS_SEEDING_SMOKE_DATA="$DATA/downloads"
export ALDUS_SEEDING_SMOKE_CONTAINER="$NAME"
docker exec "$NAME" apk list --installed qbittorrent-nox
cd "$ROOT/server"
go test ./internal/acquisition -run '^TestDisposableSeedingSmoke$' -count=1 -v
