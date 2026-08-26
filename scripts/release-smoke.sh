#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${1:-aldus:ci}
WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/aldus-release-smoke.XXXXXX")
PROJECT="aldus-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
TAG="smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
CANDIDATE="ghcr.io/mahcks/aldus:$TAG"
COOKIE_JAR="$WORKSPACE/cookies"
SOURCE_DIR="$WORKSPACE/library-media"
DOWNLOAD_DIR="$WORKSPACE/downloads"

mkdir "$SOURCE_DIR" "$DOWNLOAD_DIR"

compose() {
  ALDUS_VERSION="$TAG" \
    ALDUS_BIND_HOST=127.0.0.1 \
    ALDUS_PORT=0 \
    ALDUS_SOURCE_PATH="$SOURCE_DIR" \
    ALDUS_DOWNLOAD_PATH="$DOWNLOAD_DIR" \
    docker compose --project-name "$PROJECT" --file "$ROOT/compose.yml" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    compose logs --no-color 2>/dev/null || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$CANDIDATE" >/dev/null 2>&1 || true
  rm -rf -- "$WORKSPACE"
  exit "$status"
}
trap cleanup EXIT

wait_ready() {
  local address response
  for _ in {1..60}; do
    address=$(compose port aldus 8080 2>/dev/null || true)
    if [[ -n $address ]] && response=$(curl --fail --silent --show-error "http://$address/api/ready" 2>/dev/null); then
      printf 'Ready: %s\n' "$response"
      return 0
    fi
    sleep 2
  done
  echo "Aldus did not become ready" >&2
  return 1
}

request() {
  local address path=$1
  shift
  address=$(compose port aldus 8080)
  curl --fail --silent --show-error --cookie "$COOKIE_JAR" --cookie-jar "$COOKIE_JAR" "$@" "http://$address$path"
}

docker image inspect "$IMAGE" >/dev/null
docker tag "$IMAGE" "$CANDIDATE"

compose up --detach
wait_ready

PASSWORD="Smoke-$(date +%s)-$$"
SETUP=$(request /api/setup \
  --header 'Content-Type: application/json' \
  --request POST \
  --data "{\"username\":\"release-smoke\",\"display_name\":\"Release Smoke\",\"password\":\"$PASSWORD\",\"password_confirmation\":\"$PASSWORD\"}")
grep -q '"username":"release-smoke"' <<<"$SETUP"
grep -q '"admin":true' <<<"$SETUP"
request /api/auth/me | grep -q '"username":"release-smoke"'

compose run --rm aldus backup --archive /backups/release-smoke.tar.gz

compose stop aldus
compose rm --force aldus
DATA_VOLUME=$(docker volume ls \
  --filter "label=com.docker.compose.project=$PROJECT" \
  --filter 'label=com.docker.compose.volume=aldus-data' \
  --quiet)
[[ -n $DATA_VOLUME ]]
docker volume rm "$DATA_VOLUME" >/dev/null

compose run --rm aldus restore \
  --archive /backups/release-smoke.tar.gz \
  --data-dir /data
compose up --detach
wait_ready
request /api/auth/me | grep -q '"username":"release-smoke"'

echo "Clean install and backup restore smoke test passed"
