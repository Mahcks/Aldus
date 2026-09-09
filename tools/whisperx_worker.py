#!/usr/bin/env python3
"""Run WhisperX ASR alignment or align known Aldus text inside coarse windows."""

import argparse
import difflib
import gc
import importlib.metadata
import json
import math
import os
import re
import sys
import time
from pathlib import Path

from whisperx_worker_config import gpu_settings, load as load_worker_config
from whisperx_checkpoints import Checkpoints, fingerprint
from whisperx_diagnostics import StageDiagnostics

CUDA_UNAVAILABLE_EXIT = 78


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def report_stage(stage):
    """Best-effort telemetry; never affect alignment output or publication."""
    path = os.environ.get("ALDUS_PROGRESS_PATH")
    if not path:
        return
    try:
        temporary = Path(path + ".tmp")
        write(temporary, {"stage": stage})
        temporary.replace(path)
    except OSError:
        pass


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
        try:
            # Detection alone does not prove this wheel has kernels for the GPU.
            probe = torch.ones((16, 16), device="cuda")
            (probe @ probe).sum().item()
            torch.cuda.synchronize()
            del probe
        except RuntimeError as error:
            print(f"Aldus CUDA calculation failed: {error}", file=sys.stderr)
            raise SystemExit(CUDA_UNAVAILABLE_EXIT) from error



def canonical_words(words):
    output = []
    for word in words:
        text, start, end = word.get("word"), word.get("start"), word.get("end")
        numbers = (start, end)
        if (
            not isinstance(text, str)
            or not text.strip()
            or any(
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                for value in numbers
            )
            or end < start
        ):
            raise ValueError("invalid WhisperX word timing")
        mapped = {"text": text, "startTime": start, "endTime": end}
        score = word.get("score")
        if score is not None:
            if not isinstance(score, (int, float)) or isinstance(score, bool) or not math.isfinite(score):
                raise ValueError("invalid WhisperX word score")
            mapped["confidence"] = score
        output.append(mapped)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--output", required=True)
    parser.add_argument("--job-input")
    parser.add_argument("--raw-asr")
    parser.add_argument("--known-segments")
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--window-seconds", type=float, default=0)
    args = parser.parse_args()
    if not args.job_input and not args.audio:
        parser.error("--audio is required without --job-input")
    with StageDiagnostics(Path(args.output).with_name("stages.json")) as diagnostics:
        run(args, diagnostics)


def run(args, diagnostics):
    diagnostics.stage("loading_runtime")
    report_stage("loading_model")
    import whisperx

    if args.job_input:
        job = json.loads(Path(args.job_input).read_text())
        if job["version"] != 1:
            raise ValueError("unsupported Aldus worker contract")
        args.audio = job["audio_path"]
        args.model = job["model"]

    device, compute_type, batch_size = load_worker_config()
    if args.job_input:
        diagnostics.details(audio_duration_ms=job.get("audio_duration_ms"))
    require_accelerator(device)
    if device == "cuda":
        import ctranslate2

        import torch

        compute_type, batch_size = gpu_settings(
            ctranslate2.get_supported_compute_types("cuda"),
            torch.cuda.get_device_properties(0).total_memory,
            batch_size,
        )
    diagnostics.details(model=args.model, device=device, compute_type=compute_type, batch_size=batch_size)
    started = time.monotonic()
    checkpoints = None
    result = None
    resumed = []
    diagnostics.stage("loading_checkpoints")
    if args.job_input:
        checkpoints = Checkpoints(args.output, fingerprint(job, [device, compute_type, batch_size]))
        result = checkpoints.load("word-timings")
    model = None
    audio = None
    if result is None:
        diagnostics.stage("loading_audio")
        report_stage("loading_audio")
        audio = whisperx.load_audio(args.audio)
    if args.job_input:
        transcription = checkpoints.load("transcription") if result is None else None
        if result is not None:
            resumed.append("word-timings")
            segments = []
        else:
            if transcription is None:
                diagnostics.stage("loading_model")
                report_stage("loading_model")
                model = whisperx.load_model(args.model, device, compute_type=compute_type, vad_method="silero", language="en")
                diagnostics.stage("transcribing")
                report_stage("transcribing")
                transcription = model.transcribe(audio, batch_size=batch_size, language="en")
                checkpoints.save("transcription", {"segments": transcription["segments"]})
            else:
                resumed.append("transcription")
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
        diagnostics.stage("loading_model")
        report_stage("loading_model")
        model = whisperx.load_model(args.model, device, compute_type=compute_type, vad_method="silero", language="en")
        diagnostics.stage("transcribing")
        report_stage("transcribing")
        result = model.transcribe(audio, batch_size=batch_size, language="en")
        segments = result["segments"]
        asr_seconds = time.monotonic() - started
        if args.raw_asr:
            write(args.raw_asr, result)

    diagnostics.stage("releasing_transcription_model")
    if model is not None:
        del model
        gc.collect()
        if device == "cuda":
            import torch
            torch.cuda.empty_cache()
    diagnostics.details(resumed_stages=resumed)
    align_started = time.monotonic()
    metadata = {}
    if result is None or not args.job_input:
        diagnostics.stage("loading_alignment_model")
        report_stage("loading_alignment_model")
        align_model, metadata = whisperx.load_align_model(language_code="en", device=device)
        diagnostics.stage("aligning_words")
        report_stage("aligning_words")
        result = whisperx.align(segments, align_model, metadata, audio, device, return_char_alignments=not bool(args.job_input))
        if checkpoints is not None:
            checkpoints.save("word-timings", {"word_segments": result["word_segments"]})
        diagnostics.stage("releasing_alignment_model")
        del align_model
        audio = None
        gc.collect()
        if device == "cuda":
            import torch
            torch.cuda.empty_cache()
    if resumed:
        print("Resumed alignment from checkpoint: " + ", ".join(resumed), flush=True)
    if args.job_input:
        diagnostics.stage("matching_text")
        report_stage("matching_text")
        spoken = canonical_words(
            word for word in result["word_segments"] if "start" in word and "end" in word
        )
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
            parts = tokens(word["text"])
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
            target_indexes = list(
                dict.fromkeys(
                    actual_owners[matches[position]]
                    for position in source_indexes
                    if position in matches
                )
            )
            words = [spoken[position] for position in target_indexes]
            scores = [
                word.get("confidence")
                for word in words
                if word.get("confidence") is not None
            ]
            mean_score = sum(scores) / len(scores) if scores else None
            coverage = len(target_indexes) / max(1, len(source_indexes))
            first_word_matched = bool(source_indexes and source_indexes[0] in matches)
            status = (
                "aligned"
                if words
                and first_word_matched
                and coverage >= 0.8
                and mean_score is not None
                and mean_score >= 0.5
                else "unresolved"
            )
            if words and round(words[0]["startTime"] * 1000) < last_end_ms:
                words = []
                status = "unresolved"
            start_ms = max(
                last_end_ms,
                round(words[0]["startTime"] * 1000) if words else last_end_ms,
            )
            end_ms = max(
                start_ms + 1,
                round(words[-1]["endTime"] * 1000) if words else start_ms + 1,
            )
            last_end_ms = end_ms
            output_segments.append(
                {
                    "id": item["id"],
                    "ordinal": item["ordinal"],
                    "text": item["text"],
                    "normalized_text": " ".join(item["text"].split()),
                    "epub": {
                        "href": item["href"],
                        "dom_path": item["dom_path"],
                        "locator": {
                            "type": "dom-element",
                            "dom_path": item["dom_path"],
                        },
                    },
                    "audio": {
                        "resource": job["audio_resource"],
                        "start_ms": start_ms,
                        "end_ms": max(start_ms + 1, end_ms),
                    },
                    "status": status,
                    "highlightable": status == "aligned",
                    "confidence_signals": {
                        "mean_word_score": mean_score,
                        "text_coverage": coverage,
                        "opening_word_matched": first_word_matched,
                    },
                    "word_timings": words,
                }
            )
        diagnostics.stage("writing_artifact")
        write(
            args.output,
            {
                "version": 1,
                "tool": f"whisperx {importlib.metadata.version('whisperx')}",
                "model": args.model,
                "epub_sha256": job["epub_sha256"],
                "audio_sha256": job["audio_sha256"],
                "segments": output_segments,
            },
        )
    else:
        diagnostics.stage("writing_artifact")
        write(args.output, result)
    write(
        Path(args.output).with_name("runtime.json"),
        {
            "tool": f"whisperx {importlib.metadata.version('whisperx')}",
            "asr_model": None if args.known_segments else args.model,
            "alignment_model": metadata.get("type"),
            "resumed_stages": resumed,
            "device": device,
            "compute_type": compute_type,
            "asr_seconds": asr_seconds,
            "alignment_seconds": time.monotonic() - align_started,
            "total_seconds": time.monotonic() - started,
        },
    )


if __name__ == "__main__":
    main()
