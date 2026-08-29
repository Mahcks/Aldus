#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
media="$root/media"
mkdir -p "$media"

fetch() {
  file=$1
  url=$2
  sha=$3
  bytes=$4
  if [ ! -f "$media/$file" ]; then
    curl --fail --location --retry 3 --output "$media/$file.part" "$url"
    mv "$media/$file.part" "$media/$file"
  fi
  test "$(wc -c < "$media/$file" | tr -d ' ')" = "$bytes"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$media/$file" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "$media/$file" | awk '{print $1}')
  fi
  test "$actual" = "$sha"
}

fetch alice.epub https://www.gutenberg.org/ebooks/11.epub3.images 6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c 189231
fetch alice-chapter-01.mp3 https://archive.org/download/alicesadventuresinwonderland_2005_librivox/alicesadventuresinwonderland_01_carroll_64kb.mp3 6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a 6922917
echo "Alice fixture verified in $media"
