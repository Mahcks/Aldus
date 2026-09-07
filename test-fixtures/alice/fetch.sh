#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
media="$root/media"
mkdir -p "$media"

verify() {
  path=$1
  expected_sha=$2
  expected_bytes=$3
  actual_bytes=$(wc -c < "$path" | tr -d ' ')
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha=$(sha256sum "$path" | awk '{print $1}')
  else
    actual_sha=$(shasum -a 256 "$path" | awk '{print $1}')
  fi
  if [ "$actual_bytes" != "$expected_bytes" ] || [ "$actual_sha" != "$expected_sha" ]; then
    echo "Fixture verification failed: $path" >&2
    echo "Expected $expected_bytes bytes, SHA-256 $expected_sha" >&2
    echo "Received $actual_bytes bytes, SHA-256 $actual_sha" >&2
    return 1
  fi
}

fetch() {
  file=$1
  source=$2
  sha=$3
  bytes=$4
  if [ -f "$media/$file" ]; then
    verify "$media/$file" "$sha" "$bytes"
    return
  fi
  part="$media/$file.part"
  trap 'rm -f "$part"' EXIT HUP INT TERM
  cp "$source" "$part"
  verify "$part" "$sha" "$bytes"
  mv "$part" "$media/$file"
  trap - EXIT HUP INT TERM
}

fetch alice.epub "$root/pinned/alice.epub" 6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c 189231
fetch alice-chapter-01.mp3 "$root/pinned/alice-chapter-01.mp3" 6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a 6922917
echo "Alice fixture verified in $media"
