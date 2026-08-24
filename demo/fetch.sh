#!/bin/sh
set -eu

root=${ALDUS_DEMO_MANIFEST_DIR:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"}
media=${1:-"$root/media"}
mkdir -p "$media"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

check_sha() {
  expected=$1
	file=$2
	if command -v sha256sum >/dev/null; then
		printf '%s  %s\n' "$expected" "$file" | sha256sum -c -s
  else
    test "$(shasum -a 256 "$file" | awk '{print $1}')" = "$expected"
	fi
}

file_size() {
	stat -c %s "$1" 2>/dev/null || stat -f %z "$1" 2>/dev/null || wc -c < "$1" | tr -d ' '
}

jq -r '.works[].editions[].files[] | [.path, .url, .sha256, (.bytes | tostring)] | @tsv' "$root/catalog.json" |
while IFS="$(printf '\t')" read -r path url sha bytes; do
  file="$media/$path"
  mkdir -p "$(dirname "$file")"
  if [ ! -f "$file" ]; then
    echo "Downloading $path"
    curl --fail --location --retry 3 --output "$file.part" "$url"
    mv "$file.part" "$file"
  fi
	test "$(file_size "$file")" = "$bytes"
  check_sha "$sha" "$file"
done

echo "Demo catalog verified in $media"
