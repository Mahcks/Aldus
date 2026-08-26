#!/usr/bin/env python3
"""Run WhisperX ASR alignment or align known Aldus text inside coarse windows."""

import argparse
import difflib
import importlib.metadata
import json
import re
import sys
import time
from pathlib import Path

import whisperx
from whisperx_worker_config import load as load_worker_config

CUDA_UNAVAILABLE_EXIT = 78


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def tokens(text):
    return re.findall(r"[a-z0-9]+", text.lower().replace("’", "'"))


def require_accelerator(device):
    if device == "cuda":
        import torch

        if not torch.cuda.is_available():
            print(
                "Aldus CUDA alignment is unavailable: Docker did not expose a compatible NVIDIA GPU",
                file=sys.stderr,
            )
            raise SystemExit(CUDA_UNAVAILABLE_EXIT)


parser = argparse.ArgumentParser()
parser.add_argument("--audio")
parser.add_argument("--output", required=True)
parser.add_argument("--job-input")
parser.add_argument("--raw-asr")
parser.add_argument("--known-segments")
parser.add_argument("--model", default="base.en")
parser.add_argument("--window-seconds", type=float, default=0)
args = parser.parse_args()

if args.job_input:
    job = json.loads(Path(args.job_input).read_text())
    if job["version"] != 1:
        raise ValueError("unsupported Aldus worker contract")
    args.audio = job["audio_path"]
    args.model = job["model"]
elif not args.audio:
    parser.error("--audio is required without --job-input")

device, compute_type, batch_size = load_worker_config()
require_accelerator(device)
audio = whisperx.load_audio(args.audio)
started = time.monotonic()
if args.job_input:
    model = whisperx.load_model(args.model, device, compute_type=compute_type, vad_method="silero", language="en")
    transcription = model.transcribe(audio, batch_size=batch_size, language="en")
    segments = transcription["segments"]
    asr_seconds = time.monotonic() - started
elif args.known_segments:
    candidate = json.loads(Path(args.known_segments).read_text())
    segments = [
        {
            "text": item["normalized_text"],
            "start": max(0, item["audio"]["start_ms"] / 1000 - args.window_seconds),
            "end": item["audio"]["end_ms"] / 1000 + args.window_seconds,
        }
        for item in candidate["segments"]
    ]
    asr_seconds = 0
else:
    model = whisperx.load_model(args.model, device, compute_type=compute_type, vad_method="silero", language="en")
    result = model.transcribe(audio, batch_size=batch_size, language="en")
    segments = result["segments"]
    asr_seconds = time.monotonic() - started
    if args.raw_asr:
        write(args.raw_asr, result)

align_started = time.monotonic()
align_model, metadata = whisperx.load_align_model(language_code="en", device=device)
result = whisperx.align(segments, align_model, metadata, audio, device, return_char_alignments=True)
if args.job_input:
    spoken = [word for word in result["word_segments"] if "start" in word and "end" in word]
    expected = []
    ranges = []
    for item in job["segments"]:
        words = tokens(item["text"])
        start = len(expected)
        expected.extend(words)
        ranges.append(range(start, len(expected)))
    actual = []
    actual_owners = []
    for index, word in enumerate(spoken):
        parts = tokens(word["word"])
        actual.extend(parts)
        actual_owners.extend([index] * len(parts))
    matches = {}
    for block in difflib.SequenceMatcher(a=expected, b=actual, autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            matches[block.a + offset] = block.b + offset
    output_segments = []
    last_end_ms = 0
    for index, item in enumerate(job["segments"]):
        source_indexes = ranges[index]
        target_indexes = list(dict.fromkeys(actual_owners[matches[position]] for position in source_indexes if position in matches))
        words = [spoken[position] for position in target_indexes]
        scores = [word.get("score") for word in words if word.get("score") is not None]
        mean_score = sum(scores) / len(scores) if scores else None
        coverage = len(target_indexes) / max(1, len(source_indexes))
        first_word_matched = bool(source_indexes and source_indexes[0] in matches)
        status = "aligned" if words and first_word_matched and coverage >= 0.8 and mean_score is not None and mean_score >= 0.5 else "unresolved"
        if words and round(words[0]["start"] * 1000) < last_end_ms:
            words = []
            status = "unresolved"
        start_ms = max(last_end_ms, round(words[0]["start"] * 1000) if words else last_end_ms)
        end_ms = max(start_ms + 1, round(words[-1]["end"] * 1000) if words else start_ms + 1)
        last_end_ms = end_ms
        output_segments.append({
            "id": item["id"], "ordinal": item["ordinal"], "text": item["text"],
            "normalized_text": " ".join(item["text"].split()),
            "epub": {"href": item["href"], "dom_path": item["dom_path"], "locator": {
                "type": "dom-element", "dom_path": item["dom_path"]}},
            "audio": {"resource": job["audio_resource"], "start_ms": start_ms, "end_ms": max(start_ms + 1, end_ms)},
            "status": status, "highlightable": status == "aligned",
            "confidence_signals": {"mean_word_score": mean_score, "text_coverage": coverage,
                                   "opening_word_matched": first_word_matched},
            "word_timings": words,
        })
    write(args.output, {"version": 1, "tool": f"whisperx {importlib.metadata.version('whisperx')}",
        "model": args.model, "epub_sha256": job["epub_sha256"], "audio_sha256": job["audio_sha256"],
        "segments": output_segments})
else:
    write(args.output, result)
write(Path(args.output).with_name("runtime.json"), {
    "tool": f"whisperx {importlib.metadata.version('whisperx')}",
    "asr_model": None if args.known_segments else args.model,
    "alignment_model": metadata.get("type"),
    "device": device,
    "compute_type": compute_type,
    "asr_seconds": asr_seconds,
    "alignment_seconds": time.monotonic() - align_started,
    "total_seconds": time.monotonic() - started,
})
