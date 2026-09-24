"""Offline runtime preflight, invoked by the configured alignment worker."""

import contextlib
import json
import shutil
import socket
import sys
from unittest.mock import patch

from whisperx_worker_config import gpu_settings, load


def deny_network(*args, **kwargs):
    # HTTP clients must see an ordinary connection failure so cached models
    # remain usable (torch.hub falls back to its cache on URLError).
    raise OSError("Models must already be installed; diagnostic checks never download files")


def check(model_name):
    result = {
        "detectedGpu": "Not checked",
        "gpuTest": {"state": "not_checked"},
        "alignment": {"readiness": "not_ready", "issues": []},
    }
    issues = result["alignment"]["issues"]
    try:
        device, compute_type, batch_size = load()
    except ValueError as error:
        issues.append(str(error))
        return result

    if device == "cpu":
        result["detectedGpu"] = "Not applicable — CPU execution is configured"
        result["gpuTest"] = {"state": "not_applicable", "detail": "CPU is configured; GPU testing is skipped."}
    try:
        import torch
        if device == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError("No compatible GPU is visible. Enable NVIDIA GPU access for the container and check the host driver.")
            properties = torch.cuda.get_device_properties(0)
            result["detectedGpu"] = f"{properties.name} ({properties.total_memory / 1024**3:.1f} GB)"
            probe = torch.ones((16, 16), device="cuda")
            if (probe @ probe).sum().item() != 4096:
                raise RuntimeError("CUDA calculation returned an incorrect result")
            torch.cuda.synchronize()
            del probe
            result["gpuTest"] = {"state": "success", "detail": f"CUDA {torch.version.cuda} · GPU calculation passed"}
    except Exception as error:
        message = f"Runtime check failed: {error}"
        if device == "cuda":
            result["gpuTest"] = {"state": "failed", "error": message}
        issues.append(message)
        return result

    if not shutil.which("ffmpeg"):
        issues.append("FFmpeg is missing. Use an Aldus alignment image that includes the media tools.")
    try:
        import ctranslate2
        import nltk
        import whisperx
        nltk.data.find("tokenizers/punkt_tab/english/")
        if device == "cuda":
            compute_type, batch_size = gpu_settings(
                ctranslate2.get_supported_compute_types("cuda"),
                torch.cuda.get_device_properties(0).total_memory,
                batch_size,
            )
        # Exercise the same ASR/VAD and English aligner used by the worker.
        # All caches are supplied by Go exactly as for a normal alignment job.
        whisperx.load_model(model_name, device, compute_type=compute_type,
                            vad_method="silero", language="en", local_files_only=True)
        whisperx.load_align_model(language_code="en", device=device)
    except Exception as error:
        issues.append(f"Alignment runtime or cached models could not initialize: {error}. Check the model cache or redeploy the alignment image.")
    if not issues:
        result["alignment"]["readiness"] = "ready"
    return result


def main(model_name):
    # Dependency libraries print to stdout; reserve stdout for one JSON document.
    with contextlib.redirect_stdout(sys.stderr), patch.object(socket.socket, "connect", deny_network), patch.object(socket.socket, "connect_ex", deny_network):
        result = check(model_name)
    print(json.dumps(result))
