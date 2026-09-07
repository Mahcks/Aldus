#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
mkdir -p "$work/pinned" "$work/bin"
cp "$root/fetch.sh" "$work/fetch.sh"
cp "$root/pinned/"* "$work/pinned/"
# A cold installation must not need curl or an existing media cache.
printf '#!/bin/sh\necho "Unexpected network download" >&2\nexit 1\n' > "$work/bin/curl"
chmod +x "$work/bin/curl"
export PATH="$work/bin:$PATH"
sh "$work/fetch.sh"
cmp "$root/pinned/alice.epub" "$work/media/alice.epub"
test ! -e "$work/media/alice.epub.part"
cmp "$root/pinned/alice-chapter-01.mp3" "$work/media/alice-chapter-01.mp3"
test ! -e "$work/media/alice-chapter-01.mp3.part"
rm "$work/media/alice.epub"
printf 'corrupted fixture' > "$work/pinned/alice.epub"
if sh "$work/fetch.sh" > "$work/error.log" 2>&1; then
  echo 'Accepted a corrupted fixture' >&2
  exit 1
fi
grep -q 'Fixture verification failed' "$work/error.log"
test ! -e "$work/media/alice.epub"
test ! -e "$work/media/alice.epub.part"
echo 'Fixture installation and failure cleanup passed'
