#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
FLY_APP=${FLY_APP:-aldus-demo}
GH_BIN=${GH_BIN:-gh}
FLY_BIN=${FLY_BIN:-fly}
CURL_BIN=${CURL_BIN:-curl}
DEMO_ORIGIN=${DEMO_ORIGIN:-https://demo.aldus.media}
DOCS_ORIGIN=${DOCS_ORIGIN:-https://aldus.media}

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

release_pin_files() {
  printf '%s\n' \
    .env.example \
    demo/.env.example \
    README.md \
    docs/src/content/docs/admin/install.mdx \
    docs/src/content/docs/admin/backups.mdx
}

version_consistent() {
  local expected=$1
  local root=${2:-$ROOT}
  local file
  local actual
  local ok=0

  actual=$(sed -n 's/^ALDUS_VERSION=//p' "$root/.env.example")
  if [[ $actual != "$expected" ]]; then
    echo ".env.example pins ${actual:-nothing}; expected $expected" >&2
    ok=1
  fi

  actual=$(sed -n 's/^ALDUS_VERSION=//p' "$root/demo/.env.example")
  if [[ $actual != "$expected" ]]; then
    echo "demo/.env.example pins ${actual:-nothing}; expected $expected" >&2
    ok=1
  fi

  for file in README.md docs/src/content/docs/admin/install.mdx docs/src/content/docs/admin/backups.mdx; do
    if ! grep -Fq "$expected" "$root/$file"; then
      echo "$file does not contain server version $expected" >&2
      ok=1
    fi
  done

  return "$ok"
}

classify_paths() {
  local path

  RELEASE_CHANGED=0
  RELEASE_CONTAINER=0
  RELEASE_IOS=0
  RELEASE_DOCS=0
  RELEASE_MANUAL=0
  RELEASE_COMPATIBILITY=0

  while IFS= read -r path; do
    [[ -n $path ]] || continue
    RELEASE_CHANGED=1

    case "$path" in
      server/internal/api/contracts/*|server/internal/api/v1/*|app/src/generated/api.ts)
        RELEASE_COMPATIBILITY=1
        ;;
    esac

    case "$path" in
      *_test.go|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|test-fixtures/*|app/e2e/*|app/tests/*)
        ;;
      README.md|CONTRIBUTING.md|RELEASING.md|docs/*)
        RELEASE_DOCS=1
        ;;
      server/*|Dockerfile|tools/*|compose.yml|compose.*.yml|scripts/container-entrypoint.sh)
        RELEASE_CONTAINER=1
        ;;
      demo/*)
        RELEASE_CONTAINER=1
        ;;
      app/ios/*|app/plugins/*|app/*.native.*|app/src/*.native.*|app/src/**/*.native.*)
        RELEASE_IOS=1
        ;;
      app/*.web.*|app/src/*.web.*|app/src/**/*.web.*|app/e2e/*)
        RELEASE_CONTAINER=1
        ;;
      app/src/*|app/assets/*|app/package.json|app/bun.lock|app/app.json|app/metro.config.*|app/tailwind.config.*)
        RELEASE_CONTAINER=1
        RELEASE_IOS=1
        ;;
      .env.example)
        ;;
      Makefile|scripts/*|.github/*)
        RELEASE_MANUAL=1
        ;;
      *)
        RELEASE_MANUAL=1
        ;;
    esac
  done
}

print_surfaces() {
  local surfaces=""

  [[ $RELEASE_CONTAINER == 1 ]] && surfaces="container + demo"
  if [[ $RELEASE_IOS == 1 ]]; then
    [[ -n $surfaces ]] && surfaces="$surfaces, "
    surfaces="${surfaces}iOS"
  fi
  if [[ $RELEASE_DOCS == 1 ]]; then
    [[ -n $surfaces ]] && surfaces="$surfaces, "
    surfaces="${surfaces}docs"
  fi
  [[ -n $surfaces ]] || surfaces="no product publication"
  printf '%s\n' "$surfaces"
}

release_status() {
  local requested=${1:-}
  local version=${requested#v}
  local base
  local branch
  local clean=no
  local origin_state=unavailable
  local pins=not-checked
  local ci=unavailable
  local sha

  base=$(git -C "$ROOT" describe --tags --abbrev=0 --match 'v*' HEAD 2>/dev/null || true)
  [[ -n $base ]] || base=$(git -C "$ROOT" rev-list --max-parents=0 HEAD | tail -n 1)
  sha=$(git -C "$ROOT" rev-parse HEAD)
  branch=$(git -C "$ROOT" branch --show-current)
  [[ -z $(git -C "$ROOT" status --porcelain) ]] && clean=yes
  if git -C "$ROOT" rev-parse --verify origin/main >/dev/null 2>&1; then
    origin_state=no
    [[ $sha == "$(git -C "$ROOT" rev-parse origin/main)" ]] && origin_state=yes
  fi

  classify_paths < <(git -C "$ROOT" diff --name-only "$base"..HEAD)

  if [[ -n $requested ]]; then
    tag_for "$requested" >/dev/null
    if version_consistent "$version" >/dev/null 2>&1; then
      pins=yes
    else
      pins=no
    fi
  fi

  if command -v "$GH_BIN" >/dev/null 2>&1; then
    ci=$("$GH_BIN" run list --repo Mahcks/Aldus --workflow CI --commit "$sha" --limit 1 \
      --json conclusion --jq '.[0].conclusion // "not found"' 2>/dev/null || printf 'unavailable')
    [[ -n $ci ]] || ci="not found"
  fi

  echo "Release status"
  echo "  Base tag: $base"
  echo "  Candidate: $sha"
  echo "  Branch: ${branch:-detached} (main: $([[ $branch == main ]] && echo yes || echo no))"
  echo "  Clean working tree: $clean"
  echo "  Matches local origin/main: $origin_state"
  echo "  Requested server version: ${version:-not supplied}"
  echo "  Server pins agree: $pins"
  echo "  Latest CI: $ci"
  echo
  echo "Changed paths:"
  git -C "$ROOT" diff --name-only "$base"..HEAD | sed 's/^/  - /'
  echo
  echo "Required surfaces: $(print_surfaces)"
  [[ $RELEASE_COMPATIBILITY == 1 ]] && echo "  BLOCKED: client compatibility review required"
  [[ $RELEASE_MANUAL == 1 ]] && echo "  WARNING: manual review required"
  echo

  if [[ -z $requested ]]; then
    echo "Next (read-only): make release-status VERSION=<server-version>"
  elif [[ $RELEASE_COMPATIBILITY == 1 ]]; then
    echo "Next (read-only): git diff $base..HEAD -- server/internal/api/contracts server/internal/api/v1 app/src/generated/api.ts"
    echo "Then classify the change with the API compatibility checklist in RELEASING.md."
  elif [[ $pins == no ]]; then
    echo "Next (mutating local files only): make release-prepare VERSION=$version"
  elif [[ $clean == no ]]; then
    echo "Next (read-only): git diff --check"
  elif [[ $branch != main || $origin_state != yes ]]; then
    echo "Next (read-only): git status --short --branch"
  elif [[ $ci != success ]]; then
    echo "Next (read-only): gh run list --workflow CI --commit $sha"
  elif [[ $RELEASE_CONTAINER == 1 && $RELEASE_IOS == 1 ]]; then
    echo "Next (mutating release): make release-all VERSION=$version"
  elif [[ $RELEASE_CONTAINER == 1 ]]; then
    echo "Next (mutating release): make release VERSION=$version"
  elif [[ $RELEASE_IOS == 1 ]]; then
    echo "Next (mutating release): make ios-testflight"
  elif [[ $RELEASE_DOCS == 1 ]]; then
    echo "Next (mutating publication): manually dispatch the Docs workflow"
  else
    echo "Next: review the changed paths; no product publication was selected"
  fi
}

replace_exact() {
  local file=$1
  local old=$2
  local new=$3
  local tmp="${file}.release-prepare.$$"
  local line

  : >"$tmp"
  while IFS= read -r line || [[ -n $line ]]; do
    printf '%s\n' "${line//$old/$new}" >>"$tmp"
  done <"$file"
  mv "$tmp" "$file"
}

prepare_release() {
  local version=${1#v}
  local old
  local demo_old
  local file

  tag_for "$version" >/dev/null
  old=$(sed -n 's/^ALDUS_VERSION=//p' "$ROOT/.env.example")
  [[ -n $old ]] || fail ".env.example must contain ALDUS_VERSION"
  demo_old=$(sed -n 's/^ALDUS_VERSION=//p' "$ROOT/demo/.env.example")

  while IFS= read -r file; do
    replace_exact "$ROOT/$file" "$old" "$version"
  done < <(release_pin_files)
  if [[ -n $demo_old && $demo_old != "$old" ]]; then
    replace_exact "$ROOT/demo/.env.example" "$demo_old" "$version"
  fi

  version_consistent "$version" || fail "Server version preparation is incomplete"
  if [[ $old != "$version" ]] && grep -Fq "$old" \
    "$ROOT/.env.example" "$ROOT/demo/.env.example" "$ROOT/README.md" \
    "$ROOT/docs/src/content/docs/admin/install.mdx" \
    "$ROOT/docs/src/content/docs/admin/backups.mdx"; then
    fail "Old server version $old remains in an allowlisted file"
  fi

  echo "Prepared server version $version."
  echo "Review and commit these changes, push them, then wait for that commit's CI before releasing."
}

preflight_public_services() {
  require_command "$GH_BIN"
  require_command "$FLY_BIN"
  require_command "$CURL_BIN"
  "$GH_BIN" auth status >/dev/null
  "$GH_BIN" repo view Mahcks/Aldus >/dev/null
  "$FLY_BIN" auth whoami >/dev/null
  "$FLY_BIN" status --app "$FLY_APP" >/dev/null
  "$CURL_BIN" --fail --silent --show-error --retry 6 --retry-delay 2 --retry-all-errors \
    "$DEMO_ORIGIN/api/ready" >/dev/null
}

backup_demo() {
  local tag=$1
  local backup_name="pre-${tag}-$(date -u +%Y%m%dT%H%M%SZ)"
  local attempt

  for attempt in 1 2 3; do
    echo "Demo backup attempt $attempt of 3: /data/${backup_name}-attempt-${attempt}.tar.gz"
    if "$FLY_BIN" ssh console --app "$FLY_APP" --command \
      "aldus backup --data-dir /data/aldus --archive /data/${backup_name}-attempt-${attempt}.tar.gz"; then
      return 0
    fi
    [[ $attempt == 3 ]] || sleep 2
  done
  echo "Demo backup failed after 3 attempts" >&2
  return 1
}

verify_demo() {
  local tag=$1
  local ready_response
  local setup_response

  ready_response=$("$CURL_BIN" --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors \
    "$DEMO_ORIGIN/api/ready") || return
  grep -Fq '"status":"ready"' <<<"$ready_response" || return 1
  grep -Fq "\"server_version\":\"$tag\"" <<<"$ready_response" || return 1
  "$CURL_BIN" --fail --silent --show-error "$DEMO_ORIGIN/" >/dev/null || return
  setup_response=$("$CURL_BIN" --fail --silent --show-error "$DEMO_ORIGIN/api/setup/status") || return
  grep -Fq '"demo_available":true' <<<"$setup_response" || return 1
  "$FLY_BIN" checks list --app "$FLY_APP" | grep -qi 'passing' || return 1
}

deploy_demo() {
  local tag=$1

  require_command "$FLY_BIN"
  require_command "$CURL_BIN"
  "$FLY_BIN" auth whoami >/dev/null
  "$FLY_BIN" status --app "$FLY_APP" >/dev/null
  "$CURL_BIN" --fail --silent --show-error --retry 6 --retry-delay 2 --retry-all-errors \
    "$DEMO_ORIGIN/api/ready" >/dev/null

  git -C "$ROOT" fetch --quiet origin tag "$tag"
  git -C "$ROOT" rev-parse --verify "refs/tags/$tag^{commit}" >/dev/null 2>&1 || fail "Tag $tag does not exist"
  backup_demo "$tag"

  (
    local worktree
    worktree=$(mktemp -d "${TMPDIR:-/tmp}/aldus-demo.XXXXXX")
    cleanup() {
      git -C "$ROOT" worktree remove "$worktree" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT

    git -C "$ROOT" worktree add --quiet --detach "$worktree" "$tag"
    cd "$worktree"
    "$FLY_BIN" deploy --app "$FLY_APP" --config demo/fly.toml --ha=false --remote-only --build-arg "VERSION=$tag"
  )
  verify_demo "$tag"
  echo "Demo is healthy on $tag"
}

docs_are_current() {
  local tag=$1
  "$CURL_BIN" --fail --silent --show-error "$DOCS_ORIGIN/admin/install/" | grep -Fq "${tag#v}"
}

publish_docs() {
  local tag=$1
  local before
  local run_id=""

  require_command "$GH_BIN"
  require_command "$CURL_BIN"
  "$CURL_BIN" --fail --silent --show-error "$DOCS_ORIGIN/" >/dev/null
  before=$("$GH_BIN" run list --repo Mahcks/Aldus --workflow Docs --branch "$tag" --limit 1 \
    --json databaseId --jq '.[0].databaseId // ""')
  "$GH_BIN" workflow run docs.yml --repo Mahcks/Aldus --ref "$tag"
  for _ in {1..30}; do
    run_id=$("$GH_BIN" run list --repo Mahcks/Aldus --workflow Docs --branch "$tag" --limit 1 \
      --json databaseId --jq '.[0].databaseId // ""')
    [[ -n $run_id && $run_id != "$before" ]] && break
    sleep 2
  done
  [[ -n $run_id && $run_id != "$before" ]] || fail "The Docs workflow did not start for $tag"
  "$GH_BIN" run watch "$run_id" --repo Mahcks/Aldus --compact --exit-status
  docs_are_current "$tag" || fail "Docs published but do not advertise ${tag#v}"
  echo "Docs: $DOCS_ORIGIN"
}

partial_release() {
  local tag=$1
  local failed=$2

  echo "Images/GitHub Release: complete" >&2
  if [[ $failed == demo ]]; then
    echo "Demo: failed" >&2
    echo "Resume: make demo-deploy VERSION=${tag#v}" >&2
  else
    echo "Demo: complete" >&2
    echo "Docs: failed" >&2
    echo "Resume: ./scripts/release.sh docs ${tag#v}" >&2
  fi
}

release() {
  local tag=$1
  local sha
  local ci
  local run_id

  preflight_public_services
  [[ $(git -C "$ROOT" branch --show-current) == main ]] || fail "Release from main"
  [[ -z $(git -C "$ROOT" status --porcelain) ]] || fail "Commit or stash local changes before releasing"

  git -C "$ROOT" fetch --quiet origin main --tags
  sha=$(git -C "$ROOT" rev-parse HEAD)
  [[ $sha == "$(git -C "$ROOT" rev-parse origin/main)" ]] || fail "Local main must exactly match origin/main"
  version_consistent "${tag#v}" || fail "Public server-version pins must all match ${tag#v}"

  ci=$("$GH_BIN" run list --repo Mahcks/Aldus --workflow CI --commit "$sha" --limit 1 --json conclusion --jq '.[0].conclusion // ""')
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
    run_id=$("$GH_BIN" run list --repo Mahcks/Aldus --workflow Release --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId // ""')
    [[ -n $run_id ]] && break
    sleep 2
  done
  [[ -n ${run_id:-} ]] || fail "The release workflow did not start for $tag"
  "$GH_BIN" run watch "$run_id" --repo Mahcks/Aldus --compact --exit-status

  if ! verify_demo "$tag" >/dev/null 2>&1 && ! deploy_demo "$tag"; then
    partial_release "$tag" demo
    return 1
  fi
  if ! docs_are_current "$tag" && ! publish_docs "$tag"; then
    partial_release "$tag" docs
    return 1
  fi
  echo "Released $tag: GHCR, bundled web/API, demo, and docs"
}

case ${1:-} in
  status)
    [[ $# -le 2 ]] || fail "Usage: $0 status [VERSION]"
    release_status "${2:-}"
    ;;
  prepare)
    [[ $# == 2 ]] || fail "Usage: $0 prepare VERSION"
    prepare_release "$2"
    ;;
  release)
    [[ $# == 2 ]] || fail "Usage: $0 release VERSION"
    release "$(tag_for "$2")"
    ;;
  demo)
    [[ $# == 2 ]] || fail "Usage: $0 demo VERSION"
    deploy_demo "$(tag_for "$2")"
    ;;
  docs)
    [[ $# == 2 ]] || fail "Usage: $0 docs VERSION"
    publish_docs "$(tag_for "$2")"
    ;;
  self-test)
    [[ $(tag_for 1.2.3-beta.4) == v1.2.3-beta.4 ]]
    [[ $(tag_for v1.2.3) == v1.2.3 ]]
    if (tag_for nope >/dev/null 2>&1); then
      fail "Invalid release versions must be rejected"
    fi
    before=$(git -C "$ROOT" tag --list)
    if (GH_BIN=true FLY_BIN=aldus-command-that-does-not-exist CURL_BIN=true preflight_public_services >/dev/null 2>&1); then
      fail "Missing Fly must fail public-service preflight"
    fi
    [[ $before == "$(git -C "$ROOT" tag --list)" ]]
    output=$(partial_release v1.2.3 demo 2>&1)
    grep -Fq 'Resume: make demo-deploy VERSION=1.2.3' <<<"$output"
    if (GH_BIN=true FLY_BIN=true CURL_BIN=false verify_demo v1.2.3 >/dev/null 2>&1); then
      fail "A failed demo URL must fail verification"
    fi
    classify_paths <<'EOF'
app/src/features/ui.tsx
EOF
    [[ $RELEASE_CONTAINER == 1 && $RELEASE_IOS == 1 ]]
    classify_paths <<'EOF'
app/src/components/Reader.native.tsx
EOF
    [[ $RELEASE_CONTAINER == 0 && $RELEASE_IOS == 1 ]]
    classify_paths <<'EOF'
app/src/components/Reader.web.tsx
EOF
    [[ $RELEASE_CONTAINER == 1 && $RELEASE_IOS == 0 ]]
    classify_paths <<'EOF'
docs/src/content/docs/index.mdx
EOF
    [[ $RELEASE_DOCS == 1 && $RELEASE_CONTAINER == 0 && $RELEASE_IOS == 0 ]]
    classify_paths <<'EOF'
something-new.txt
EOF
    [[ $RELEASE_MANUAL == 1 ]]
    classify_paths <<'EOF'
server/internal/api/v1/setup.go
EOF
    [[ $RELEASE_COMPATIBILITY == 1 ]]
    (
      fixture=$(mktemp -d "${TMPDIR:-/tmp}/aldus-release-test.XXXXXX")
      trap 'rm -rf "$fixture"' EXIT
      mkdir -p "$fixture/demo" "$fixture/docs/src/content/docs/admin"
      printf 'ALDUS_VERSION=1.2.3\n' >"$fixture/.env.example"
      printf 'ALDUS_VERSION=1.2.2\n' >"$fixture/demo/.env.example"
      printf 'Install 1.2.3\n' >"$fixture/README.md"
      printf 'Install 1.2.3\n' >"$fixture/docs/src/content/docs/admin/install.mdx"
      printf 'Backup 1.2.3\n' >"$fixture/docs/src/content/docs/admin/backups.mdx"
      if version_consistent 1.2.3 "$fixture" >/dev/null 2>&1; then
        fail "Stale release pins must be rejected"
      fi
    )
    echo "release checks passed"
    ;;
  *)
    fail "Usage: $0 <status|prepare|release|demo|docs|self-test> [VERSION]"
    ;;
esac
