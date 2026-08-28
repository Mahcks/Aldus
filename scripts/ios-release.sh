#!/usr/bin/env bash

set -euo pipefail
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIG="$ROOT/scripts/ios-release.env"

[[ -f $CONFIG ]] && source "$CONFIG"

INTERNAL_GROUP=${ASC_INTERNAL_TESTFLIGHT_GROUP:-Aldus Internal}
EXTERNAL_GROUP=${ASC_EXTERNAL_TESTFLIGHT_GROUP:-Aldus External}

fail() {
  echo "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_asc() {
  require_command asc
  asc auth status >/dev/null
  if [[ -z ${ASC_APP_ID:-} ]]; then
    ASC_APP_ID=$(asc apps list --output json | node -e '
let input=""; process.stdin.on("data", (chunk)=>input+=chunk); process.stdin.on("end", ()=>{
  const value=JSON.parse(input); const items=Array.isArray(value)?value:(value.data||value.items||[]);
  const app=items.find((item)=>(item.attributes?.bundleId||item.bundleId)==="com.mahcks.aldus");
  if(app) process.stdout.write(String(app.id||app.attributes?.id||""));
});
')
  fi
  [[ -n ${ASC_APP_ID:-} ]] || fail "asc cannot find com.mahcks.aldus; set ASC_APP_ID in scripts/ios-release.env"
  export ASC_APP_ID
}

check_source() {
  local sha
  local origin_sha

  [[ $(uname -s) == Darwin ]] || fail "iOS releases must run on the Mac mini"
  [[ -z $(git -C "$ROOT" status --porcelain) ]] || fail "Commit or stash local changes before building"
  git -C "$ROOT" fetch --quiet origin main
  sha=$(git -C "$ROOT" rev-parse HEAD)
  origin_sha=$(git -C "$ROOT" rev-parse origin/main)
  [[ $sha == "$origin_sha" ]] || fail "Build the exact current origin/main commit"
  printf '%s\n' "$sha"
}

ensure_group() {
  local name=$1
  local kind=$2
  local groups

  groups=$(asc testflight groups list --app "$ASC_APP_ID" --output json)
  if node - "$groups" "$name" <<'NODE'
const [raw, wanted] = process.argv.slice(2);
const value = JSON.parse(raw);
const items = Array.isArray(value) ? value : value.data || value.items || [];
process.exit(items.some((item) => (item.attributes?.name || item.name) === wanted) ? 0 : 1);
NODE
  then
    return
  fi

  if [[ $kind == internal ]]; then
    asc testflight groups create --app "$ASC_APP_ID" --name "$name" --internal >/dev/null
  else
    asc testflight groups create --app "$ASC_APP_ID" --name "$name" >/dev/null
  fi
  echo "Created TestFlight group: $name"
}

testflight() (
  local sha
  local short_sha
  local server_version
  local test_notes
  local artifact_dir
  local ipa
  local -a ipas=()
  local lock_dir="${TMPDIR:-/tmp}/aldus-ios-release.lock"

  if ! mkdir "$lock_dir" 2>/dev/null; then
    echo "Another iOS release owns $lock_dir" >&2
    [[ -f $lock_dir/owner ]] && cat "$lock_dir/owner" >&2
    exit 1
  fi
  printf 'pid=%s started=%s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$lock_dir/owner"
  cleanup() {
    rm -f "$lock_dir/owner"
    rmdir "$lock_dir" 2>/dev/null || true
  }
  trap cleanup EXIT

  require_command bun
  require_command npx
  require_asc
  sha=$(check_source)
  short_sha=${sha:0:12}
  server_version=$(sed -n 's/^ALDUS_VERSION=//p' "$ROOT/.env.example")
  [[ -n $server_version ]] || fail ".env.example must pin ALDUS_VERSION"
  test_notes="${BETA_WHATS_NEW:-Aldus beta} | server $server_version | commit $short_sha"
  artifact_dir="$ROOT/artifacts/ios/$short_sha-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$artifact_dir"

  node - "$ROOT/app/app.json" "$ROOT/app/package.json" <<'NODE'
const fs = require('fs');
const [appPath, packagePath] = process.argv.slice(2);
const appVersion = JSON.parse(fs.readFileSync(appPath, 'utf8')).expo.version;
const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
if (appVersion !== packageVersion) {
  console.error(`Version mismatch: app.json=${appVersion}, package.json=${packageVersion}`);
  process.exit(1);
}
NODE

  ensure_group "$INTERNAL_GROUP" internal

  (
    cd "$ROOT/app"
    bun install --frozen-lockfile
    EAS_LOCAL_BUILD_ARTIFACTS_DIR="$artifact_dir" \
      npx eas-cli@22.4.0 build --platform ios --profile production --local
  )

  while IFS= read -r ipa; do
    ipas+=("$ipa")
  done < <(find "$artifact_dir" -type f -name '*.ipa' -print)
  [[ ${#ipas[@]} == 1 ]] || fail "Expected one IPA in $artifact_dir, found ${#ipas[@]}"
  ipa=${ipas[0]}
  printf 'git_commit=%s\nserver_version=%s\n' "$sha" "$server_version" >"$artifact_dir/build-context.txt"

  asc publish testflight \
    --app "$ASC_APP_ID" \
    --ipa "$ipa" \
    --group "$INTERNAL_GROUP" \
    --test-notes "$test_notes" \
    --locale "${RELEASE_LOCALE:-en-US}" \
    --wait \
    --timeout "${ASC_UPLOAD_TIMEOUT:-45m}" | tee "$artifact_dir/asc-publish.json"

  echo "IPA retained at $ipa"
  echo "Promote the printed build ID with: make ios-external BUILD_ID=<id>"
)

external() {
  local build_id=$1
  local submissions

  require_asc
  ensure_group "$INTERNAL_GROUP" internal
  ensure_group "$EXTERNAL_GROUP" external
  asc validate testflight --app "$ASC_APP_ID" --build "$build_id"
  asc builds add-groups --build-id "$build_id" --group "$EXTERNAL_GROUP"

  submissions=$(asc testflight review submissions list --build-id "$build_id" --output json)
  if node -e 'const value=JSON.parse(process.argv[1]); const items=Array.isArray(value)?value:(value.data||value.items||[]); process.exit(items.length ? 0 : 1)' "$submissions"
  then
    echo "Build $build_id already has a TestFlight review submission"
  else
    asc testflight review submit --build-id "$build_id" --confirm
  fi
}

stage_release() {
  local version=$1
  local build_id=$2
  local versions
  local version_id

  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "App Store VERSION must look like 0.1.0"
  require_asc
  versions=$(asc versions list --app "$ASC_APP_ID" --platform IOS --output json)
  version_id=$(node -e '
const value=JSON.parse(process.argv[1]); const wanted=process.argv[2];
const items=Array.isArray(value)?value:(value.data||value.items||[]);
const item=items.find((entry)=>(entry.attributes?.version||entry.version)===wanted);
if(item) process.stdout.write(String(item.id||item.attributes?.id||""));
' "$versions" "$version")

  if [[ -z $version_id ]]; then
    version_id=$(asc versions create --app "$ASC_APP_ID" --version "$version" --platform IOS --release-type MANUAL --output json | node -e '
let input=""; process.stdin.on("data", (chunk)=>input+=chunk); process.stdin.on("end", ()=>{const value=JSON.parse(input); process.stdout.write(String(value.id||value.data?.id||value.attributes?.id||""));});
')
  fi
  [[ -n $version_id ]] || fail "Could not resolve App Store version $version"

  asc versions attach-build --version-id "$version_id" --build "$build_id" >/dev/null
  asc validate --app "$ASC_APP_ID" --version-id "$version_id" --platform IOS --strict
  echo "App Store version $version is staged with build $build_id"
  echo "Review it in App Store Connect, then use Submit for Review"
}

remote() {
  local ref=${1:-HEAD}
  local sha
  local origin_sha

  require_command ssh
  [[ -n ${MAC_BUILD_HOST:-} ]] || fail "Set MAC_BUILD_HOST in scripts/ios-release.env"
  [[ -n ${MAC_BUILD_PATH:-} ]] || fail "Set MAC_BUILD_PATH in scripts/ios-release.env"
  git -C "$ROOT" fetch --quiet origin main
  sha=$(git -C "$ROOT" rev-parse "$ref^{commit}")
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || fail "Could not resolve REF=$ref"
  origin_sha=$(git -C "$ROOT" rev-parse origin/main)
  [[ $sha == "$origin_sha" ]] || fail "REF must resolve to the exact current origin/main commit"

  ssh "$MAC_BUILD_HOST" \
    "set -euo pipefail; cd '$MAC_BUILD_PATH'; test -z \"\$(git status --porcelain)\"; git fetch origin main; test \"\$(git rev-parse origin/main)\" = '$sha'; git checkout --detach '$sha'; make ios-testflight"
}

case ${1:-} in
  testflight)
    if [[ $(uname -s) == Darwin ]]; then
      testflight
    else
      remote HEAD
    fi
    ;;
  external)
    [[ $# == 2 ]] || fail "Usage: $0 external BUILD_ID"
    external "$2"
    ;;
  release)
    [[ $# == 3 ]] || fail "Usage: $0 release VERSION BUILD_ID"
    stage_release "$2" "$3"
    ;;
  remote)
    [[ $# -le 2 ]] || fail "Usage: $0 remote [REF]"
    remote "${2:-HEAD}"
    ;;
  self-test)
    [[ 0.1.0 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
    [[ ! 0.1.0-beta.1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
    echo "iOS release checks passed"
    ;;
  *)
    fail "Usage: $0 <testflight|external|release|remote>"
    ;;
esac
