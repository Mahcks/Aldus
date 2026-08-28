#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
FLY_APP=${FLY_APP:-aldus-demo}

fail() {
  echo "$*" >&2
  exit 1
}

tag_for() {
  local version=${1#v}
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] || fail "Invalid release version: $1"
  printf 'v%s\n' "$version"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

deploy_demo() {
  local tag=$1
  local backup_name

  require_command fly
  require_command curl

  git -C "$ROOT" fetch --quiet origin tag "$tag"
  git -C "$ROOT" rev-parse --verify "refs/tags/$tag^{commit}" >/dev/null 2>&1 || fail "Tag $tag does not exist"

  if [[ ${SKIP_DEMO_BACKUP:-0} != 1 ]]; then
    backup_name="pre-${tag}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
    echo "Backing up the demo to /data/$backup_name"
    fly ssh console --app "$FLY_APP" --command \
      "aldus backup --data-dir /data/aldus --archive /data/$backup_name"
  fi

  (
    local worktree
    worktree=$(mktemp -d "${TMPDIR:-/tmp}/aldus-demo.XXXXXX")
    cleanup() {
      git -C "$ROOT" worktree remove "$worktree" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT

    git -C "$ROOT" worktree add --quiet --detach "$worktree" "$tag"
    cd "$worktree"
    fly deploy --app "$FLY_APP" --config demo/fly.toml --ha=false --remote-only --build-arg "VERSION=$tag"
    curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors \
      "https://demo.aldus.media/api/ready" >/dev/null
  )
  echo "Demo is healthy on $tag"
}

release() {
  local tag=$1
  local sha
  local ci
  local run_id

  require_command gh
  [[ $(git -C "$ROOT" branch --show-current) == main ]] || fail "Release from main"
  [[ -z $(git -C "$ROOT" status --porcelain) ]] || fail "Commit or stash local changes before releasing"

  git -C "$ROOT" fetch --quiet origin main --tags
  sha=$(git -C "$ROOT" rev-parse HEAD)
  [[ $sha == "$(git -C "$ROOT" rev-parse origin/main)" ]] || fail "Local main must exactly match origin/main"
  [[ $(sed -n 's/^ALDUS_VERSION=//p' "$ROOT/.env.example") == ${tag#v} ]] || fail ".env.example must pin ${tag#v}"

  ci=$(gh run list --repo Mahcks/Aldus --workflow CI --commit "$sha" --limit 1 --json conclusion --jq '.[0].conclusion // ""')
  [[ $ci == success ]] || fail "CI has not succeeded for $sha"

  if git -C "$ROOT" rev-parse --verify "refs/tags/$tag^{commit}" >/dev/null 2>&1; then
    [[ $(git -C "$ROOT" rev-parse "refs/tags/$tag^{commit}") == "$sha" ]] || fail "$tag already points to another commit"
  else
    git -C "$ROOT" tag -a "$tag" -m "Aldus $tag"
  fi

  if ! git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    git -C "$ROOT" push origin "$tag"
  fi

  echo "Waiting for the container release workflow"
  for _ in {1..30}; do
    run_id=$(gh run list --repo Mahcks/Aldus --workflow Release --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId // ""')
    [[ -n $run_id ]] && break
    sleep 2
  done
  [[ -n ${run_id:-} ]] || fail "The release workflow did not start for $tag"
  gh run watch "$run_id" --repo Mahcks/Aldus --compact --exit-status

  deploy_demo "$tag"
  echo "Released $tag: GHCR, bundled web/API, and demo"
}

case ${1:-} in
  release)
    [[ $# == 2 ]] || fail "Usage: $0 release VERSION"
    release "$(tag_for "$2")"
    ;;
  demo)
    [[ $# == 2 ]] || fail "Usage: $0 demo VERSION"
    deploy_demo "$(tag_for "$2")"
    ;;
  self-test)
    [[ $(tag_for 1.2.3-beta.4) == v1.2.3-beta.4 ]]
    [[ $(tag_for v1.2.3) == v1.2.3 ]]
    if (tag_for nope >/dev/null 2>&1); then
      fail "Invalid release versions must be rejected"
    fi
    echo "release checks passed"
    ;;
  *)
    fail "Usage: $0 <release|demo> VERSION"
    ;;
esac
