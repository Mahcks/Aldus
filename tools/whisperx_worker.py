#!/usr/bin/env python3
"""Run WhisperX ASR alignment or align known Aldus text inside coarse windows."""

import argparse
import importlib.metadata
import json
import time
from pathlib import Path

import whisperx


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


parser = argparse.ArgumentParser()
parser.add_argument("--audio", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--raw-asr")
parser.add_argument("--known-segments")
parser.add_argument("--model", default="base.en")
parser.add_argument("--window-seconds", type=float, default=0)
args = parser.parse_args()

device = "cpu"
audio = whisperx.load_audio(args.audio)
started = time.monotonic()
if args.known_segments:
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
    model = whisperx.load_model(args.model, device, compute_type="int8", vad_method="silero", language="en")
    result = model.transcribe(audio, batch_size=4, language="en")
    segments = result["segments"]
    asr_seconds = time.monotonic() - started
    if args.raw_asr:
        write(args.raw_asr, result)

align_started = time.monotonic()
align_model, metadata = whisperx.load_align_model(language_code="en", device=device)
result = whisperx.align(segments, align_model, metadata, audio, device, return_char_alignments=True)
write(args.output, result)
write(Path(args.output).with_name("runtime.json"), {
    "tool": f"whisperx {importlib.metadata.version('whisperx')}",
    "asr_model": None if args.known_segments else args.model,
    "alignment_model": metadata.get("type"),
    "device": device,
    "compute_type": "int8",
    "asr_seconds": asr_seconds,
    "alignment_seconds": time.monotonic() - align_started,
    "total_seconds": time.monotonic() - started,
})
