#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${1:-aldus:ci}
PREVIOUS_IMAGE=${PREVIOUS_IMAGE:-}
EXPECT_SCHEMA_UPGRADE=${EXPECT_SCHEMA_UPGRADE:-0}
EXPECTED_VERSION=${EXPECTED_VERSION:-}
WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/aldus-release-smoke.XXXXXX")
PROJECT="aldus-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
UPGRADE_PROJECT="${PROJECT}-upgrade"
TAG="smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
CANDIDATE="ghcr.io/mahcks/aldus:$TAG"
COOKIE_JAR="$WORKSPACE/cookies"
UPGRADE_COOKIE_JAR="$WORKSPACE/upgrade-cookies"
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

upgrade_compose() {
  ALDUS_VERSION="$UPGRADE_TAG" \
    ALDUS_BIND_HOST=127.0.0.1 \
    ALDUS_PORT=0 \
    ALDUS_SOURCE_PATH="$SOURCE_DIR" \
    ALDUS_DOWNLOAD_PATH="$DOWNLOAD_DIR" \
    docker compose --project-name "$UPGRADE_PROJECT" --file "$ROOT/compose.yml" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    compose logs --no-color 2>/dev/null || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [[ -n ${UPGRADE_TAG:-} ]]; then
    upgrade_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  docker image rm "$CANDIDATE" >/dev/null 2>&1 || true
  rm -rf -- "$WORKSPACE"
  exit "$status"
}
trap cleanup EXIT

wait_ready() {
  local compose_command=${1:-compose}
  local expected_version=${2:-}
  local address response
  for _ in {1..60}; do
    address=$($compose_command port aldus 8080 2>/dev/null || true)
    if [[ -n $address ]] && response=$(curl --fail --silent --show-error "http://$address/api/ready" 2>/dev/null); then
      if [[ -n $expected_version ]] && ! grep -Fq "\"server_version\":\"$expected_version\"" <<<"$response"; then
        echo "Ready endpoint does not report $expected_version: $response" >&2
        return 1
      fi
      printf 'Ready: %s\n' "$response"
      return 0
    fi
    sleep 2
  done
  echo "Aldus did not become ready" >&2
  return 1
}

request() {
  request_for "$COOKIE_JAR" compose "$@"
}

request_for() {
  local cookie_jar=$1
  local compose_command=$2
  local path=$3
  local address
  shift 3
  address=$($compose_command port aldus 8080)
  curl --fail --silent --show-error --cookie "$cookie_jar" --cookie-jar "$cookie_jar" "$@" "http://$address$path"
}

json_id() {
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p'
}

upgrade_from_previous() {
  local previous_tag=${PREVIOUS_IMAGE##*:}
  local password="Upgrade-$(date +%s)-$$"
  local library work representation
  local data_volume

  UPGRADE_TAG=$previous_tag
  docker pull "$PREVIOUS_IMAGE"
  upgrade_compose up --detach
  wait_ready upgrade_compose
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose /api/setup \
    --header 'Content-Type: application/json' --request POST \
    --data "{\"username\":\"upgrade-smoke\",\"display_name\":\"Upgrade Smoke\",\"password\":\"$password\",\"password_confirmation\":\"$password\"}" >/dev/null
  library=$(request_for "$UPGRADE_COOKIE_JAR" upgrade_compose /api/libraries \
    --header 'Content-Type: application/json' --request POST --data '{"name":"Upgrade Library"}' | json_id)
  [[ -n $library ]]
  work=$(request_for "$UPGRADE_COOKIE_JAR" upgrade_compose "/api/libraries/$library/works" \
    --header 'Content-Type: application/json' --request POST --data '{"title":"Upgrade Book","author":"Aldus"}' | json_id)
  [[ -n $work ]]
  representation=$(request_for "$UPGRADE_COOKIE_JAR" upgrade_compose "/api/works/$work/representations" \
    --header 'Content-Type: application/json' --request POST --data '{"kind":"epub","label":"Upgrade Edition"}' | json_id)
  [[ -n $representation ]]
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose "/api/representations/$representation/state" \
    --header 'Content-Type: application/json' --request PUT \
    --data '{"epub_locator":{"href":"chapter.xhtml"},"reader_layout":"paginated","expected_revision":0}' \
    | grep -q 'chapter.xhtml'
  upgrade_compose run --rm aldus backup --archive /backups/pre-upgrade.tar.gz

  upgrade_compose stop aldus
  upgrade_compose rm --force aldus
  UPGRADE_TAG=$TAG
  upgrade_compose up --detach
  wait_ready upgrade_compose
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose /api/libraries | grep -q 'Upgrade Library'
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose "/api/representations/$representation/state" | grep -q 'chapter.xhtml'
  upgrade_compose restart aldus
  wait_ready upgrade_compose
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose /api/libraries | grep -q 'Upgrade Library'

  upgrade_compose stop aldus
  upgrade_compose rm --force aldus
  if [[ $EXPECT_SCHEMA_UPGRADE == 1 ]]; then
    UPGRADE_TAG=$previous_tag
    upgrade_compose up --detach
    for _ in {1..30}; do
      if [[ $(upgrade_compose ps --status running --quiet aldus) == "" ]]; then
        break
      fi
      sleep 1
    done
    [[ $(upgrade_compose ps --status running --quiet aldus) == "" ]]
  else
    echo "Schema version is unchanged; previous-image refusal is not applicable"
  fi

  upgrade_compose rm --stop --force aldus
  UPGRADE_TAG=$previous_tag
  data_volume=$(docker volume ls \
    --filter "label=com.docker.compose.project=$UPGRADE_PROJECT" \
    --filter 'label=com.docker.compose.volume=aldus-data' --quiet)
  [[ -n $data_volume ]]
  docker volume rm "$data_volume" >/dev/null
  upgrade_compose run --rm aldus restore --archive /backups/pre-upgrade.tar.gz --data-dir /data
  upgrade_compose up --detach
  wait_ready upgrade_compose
  rm -f "$UPGRADE_COOKIE_JAR"
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose /api/auth/login \
    --header 'Content-Type: application/json' --request POST \
    --data "{\"username\":\"upgrade-smoke\",\"password\":\"$password\"}" >/dev/null
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose /api/libraries | grep -q 'Upgrade Library'
  request_for "$UPGRADE_COOKIE_JAR" upgrade_compose "/api/representations/$representation/state" | grep -q 'chapter.xhtml'
  echo "Previous release upgrade and backup restore passed"
}

docker image inspect "$IMAGE" >/dev/null
docker tag "$IMAGE" "$CANDIDATE"

if [[ -n $PREVIOUS_IMAGE ]]; then
  upgrade_from_previous
else
  echo "No previous release image supplied; upgrade gate skipped for this first release"
fi

compose up --detach
wait_ready compose "$EXPECTED_VERSION"

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
STATUS=$(request /api/auth/me --output /dev/null --write-out '%{http_code}' || true)
[[ $STATUS == 401 ]]
LOGIN=$(request /api/auth/login \
  --header 'Content-Type: application/json' \
  --request POST \
  --data "{\"username\":\"release-smoke\",\"password\":\"$PASSWORD\"}")
grep -q '"username":"release-smoke"' <<<"$LOGIN"
request /api/auth/me | grep -q '"username":"release-smoke"'

echo "Clean install and backup restore smoke test passed"
