#!/bin/sh
set -eu

image=${1:?usage: check-alignment-image.sh IMAGE cpu|cuda}
mode=${2:?usage: check-alignment-image.sh IMAGE cpu|cuda}

case "$mode" in
  cpu)
    docker run --rm --entrypoint python3 "$image" -c '
import importlib.metadata as metadata
import os
import platform
import torch
import whisperx

assert torch.version.cuda is None, torch.version.cuda
assert os.environ.get("ALDUS_ALIGNMENT_ACCELERATOR", "cpu") == "cpu"
assert metadata.version("whisperx") == "3.8.6"
assert metadata.version("ctranslate2") == "4.8.1"
if platform.machine() == "aarch64":
    for package in ("torchcodec", "triton"):
        try:
            metadata.version(package)
        except metadata.PackageNotFoundError:
            pass
        else:
            raise AssertionError(f"{package} must not be installed on Linux ARM64")
else:
    assert metadata.version("torchcodec") == "0.7.0"
    assert metadata.version("triton") == "3.4.0"
whisperx.load_model("base.en", "cpu", compute_type="int8", vad_method="silero", language="en", local_files_only=True)
whisperx.load_align_model(language_code="en", device="cpu")
print("CPU alignment runtime initialized")
'
    cache_volume="aldus-model-check-$$"
    docker volume create "$cache_volume" >/dev/null
    trap 'docker volume rm -f "$cache_volume" >/dev/null 2>&1 || true' EXIT
    if docker run --rm -e ALDUS_LOG_LEVEL=invalid -v "$cache_volume:/data" "$image" >/dev/null 2>&1; then
      echo "expected the deliberately invalid Aldus configuration to fail" >&2
      exit 1
    fi
    docker run --rm --entrypoint sh -v "$cache_volume:/data" "$image" \
      -c 'test -n "$(find /data/models -type f -print -quit)"'
    docker volume rm -f "$cache_volume" >/dev/null
    trap - EXIT
    ;;
  cuda)
    docker run --rm --entrypoint python3 "$image" -c '
import importlib.metadata as metadata
import os
import torch
import whisperx

assert torch.version.cuda == "12.8", torch.version.cuda
assert os.environ["ALDUS_ALIGNMENT_ACCELERATOR"] == "cuda"
assert metadata.version("whisperx") == "3.8.6"
assert metadata.version("ctranslate2") == "4.8.1"
assert any(os.scandir("/opt/aldus-models"))
print("CUDA alignment dependencies installed; physical GPU runtime not exercised")
'
    set +e
    docker run --rm --entrypoint python3 "$image" \
      /app/tools/whisperx_worker.py --audio /missing --output /tmp/alignment.json
    status=$?
    set -e
    if [ "$status" -ne 78 ]; then
      echo "CUDA worker without GPU exited $status; expected 78" >&2
      exit 1
    fi
    ;;
  *)
    echo "mode must be cpu or cuda" >&2
    exit 2
    ;;
esac
