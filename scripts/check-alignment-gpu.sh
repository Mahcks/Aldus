#!/bin/sh
# Isolated public-domain speech check; never mounts Aldus data or starts a server.
set -eu
image=${1:?usage: check-alignment-gpu.sh IMAGE}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
audio="$root/test-fixtures/alice/pinned/alice-chapter-01.mp3"
if [ ! -f "$audio" ]; then
  echo "Missing pinned Alice fixture: $audio" >&2
  exit 1
fi
docker run --rm --gpus all --network none \
  -v "$audio:/fixture.mp3:ro" \
  -e HF_HOME=/opt/aldus-models \
  -e TORCH_HOME=/opt/aldus-models/torch \
  -e NLTK_DATA=/opt/aldus-models/nltk \
  -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 \
  --entrypoint sh "$image" -ec '
    ffmpeg -v error -i /fixture.mp3 -t 90 -ar 16000 -ac 1 /tmp/sample.wav
    python3 /app/tools/whisperx_worker.py --audio /tmp/sample.wav --output /tmp/alignment.json
    python3 -c '\''import json
result = json.load(open("/tmp/alignment.json"))
assert len(result["word_segments"]) > 10, "No usable speech alignment"
runtime = json.load(open("/tmp/runtime.json"))
assert runtime["device"] == "cuda", "GPU was not used"
print("GPU speech alignment passed:", runtime)
'\''
  '
