#!/usr/bin/env python3
"""Convert a stalign EPUB to Aldus candidate JSON and evaluate golden anchors."""

import argparse
import difflib
import hashlib
import json
import math
import re
import statistics
import struct
import subprocess
import wave
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

XHTML = "http://www.w3.org/1999/xhtml"
SMIL = "http://www.w3.org/ns/SMIL"


def normalized(text):
    return " ".join(text.split())


def local(tag):
    return tag.rsplit("}", 1)[-1]


def node_path(element, parents):
    parts = []
    while element is not None:
        parent = parents.get(element)
        siblings = [child for child in parent] if parent is not None else [element]
        same = [child for child in siblings if local(child.tag) == local(element.tag)]
        parts.append(f"{local(element.tag)}[{same.index(element) + 1}]")
        element = parent
    return "/".join(reversed(parts))


def text_stream(root):
    parents = {child: parent for parent in root.iter() for child in parent}
    chars = []

    def add(text, owner, number):
        if text:
            path = f"{node_path(owner, parents)}/text()[{number}]"
            chars.extend((character, path, offset) for offset, character in enumerate(text))

    def walk(element):
        number = 1
        add(element.text, element, number)
        if element.text is not None:
            number += 1
        for child in element:
            walk(child)
            add(child.tail, element, number)
            if child.tail is not None:
                number += 1

    walk(root)
    compact, locations, pending_space = [], [], None
    for character, path, offset in chars:
        if character.isspace():
            pending_space = (path, offset)
        else:
            if pending_space is not None and compact:
                compact.append(" ")
                locations.append(pending_space)
            compact.append(character)
            locations.append((path, offset))
            pending_space = None
    return "".join(compact), locations, chars


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def convert(args):
    resource = "OEBPS/6260297267691793459_11-h-1.htm.xhtml"
    with zipfile.ZipFile(args.epub) as source, zipfile.ZipFile(args.aligned_epub) as aligned:
        original = ET.fromstring(source.read(resource))
        marked = ET.fromstring(aligned.read(resource))
        smil_name = next(name for name in aligned.namelist() if name.endswith("11-h-1.htm.smil"))
        smil = ET.fromstring(aligned.read(smil_name))

    linear, locations, source_chars = text_stream(original)
    source_indexes = {(path, offset): index for index, (_, path, offset) in enumerate(source_chars)}
    timing = {}
    for par in smil.iter(f"{{{SMIL}}}par"):
        audio = par.find(f"{{{SMIL}}}audio")
        timing[par.attrib["id"]] = (
            round(float(audio.attrib["clipBegin"].removesuffix("s")) * 1000),
            round(float(audio.attrib["clipEnd"].removesuffix("s")) * 1000),
        )

    transcript = json.loads(Path(args.transcript).read_text())
    words = [item for item in transcript["timeline"] if item["type"] == "word"]
    cursor, segments = 0, []
    for element in marked.iter():
        segment_id = element.attrib.get("id", "")
        if segment_id not in timing:
            continue
        text = normalized("".join(element.itertext()))
        start = linear.find(text, cursor)
        if start < 0:
            raise ValueError(f"cannot map {segment_id} back to frozen EPUB: {text[:80]!r}")
        end = start + len(text)
        cursor = end
        raw_start = source_indexes[locations[start]]
        raw_end = source_indexes[locations[end - 1]] + 1
        authoritative_text = "".join(character for character, _, _ in source_chars[raw_start:raw_end])
        start_ms, end_ms = timing[segment_id]
        nearby = [word for word in words if start_ms <= round(word["startTime"] * 1000) < end_ms]
        segments.append({
            "id": segment_id,
            "sequence": len(segments),
            "text": authoritative_text,
            "normalized_text": text,
            "epub": {
                "href": resource,
                "start": {"dom_path": locations[start][0], "node_offset": locations[start][1]},
                "end": {"dom_path": locations[end - 1][0], "node_offset": locations[end - 1][1] + 1},
                "cfi": None,
            },
            "audio": {"resource": "alice-chapter-01.mp3", "start_ms": start_ms, "end_ms": end_ms},
            "confidence": statistics.fmean(word["confidence"] for word in nearby) if nearby else None,
            "word_timings": nearby,
        })

    output = {
        "version": 1,
        "state": "candidate",
        "tool": "@storyteller-platform/align 0.1.57",
        "model": "whisper.cpp base.en",
        "epub_sha256": sha256(args.epub),
        "audio_sha256": sha256(args.audio),
        "segments": segments,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")


def evaluate(args):
    candidate = json.loads(Path(args.candidate).read_text())
    golden = json.loads(Path(args.anchors).read_text())
    results = []
    for anchor in golden["anchors"]:
        matches = [segment for segment in candidate["segments"] if anchor["normalized_text"] in segment["normalized_text"]]
        if len(matches) != 1:
            raise ValueError(f"{anchor['id']}: expected one exact passage match, got {len(matches)}")
        segment = matches[0]
        manual = anchor["audio"]["timestamp_ms"]
        generated = segment["audio"]["start_ms"]
        results.append({
            "anchor_id": anchor["id"],
            "manual_timestamp_ms": manual,
            "generated_timestamp_ms": generated,
            "absolute_error_ms": abs(generated - manual),
            "restored_text_match": segment["normalized_text"] == anchor["normalized_text"],
            "confidence": segment["confidence"],
            "segment_id": segment["id"],
        })
    errors = [row["absolute_error_ms"] for row in results]
    report = {
        "candidate": str(args.candidate),
        "anchors": results,
        "metrics": {
            "median_absolute_error_ms": statistics.median(errors),
            "mean_absolute_error_ms": statistics.fmean(errors),
            "maximum_absolute_error_ms": max(errors),
            "within_100_ms": sum(error <= 100 for error in errors),
            "within_250_ms": sum(error <= 250 for error in errors),
            "within_500_ms": sum(error <= 500 for error in errors),
            "within_1000_ms": sum(error <= 1000 for error in errors),
            "over_1000_ms": sum(error > 1000 for error in errors),
            "exact_passage_restoration": sum(row["restored_text_match"] for row in results),
            "percentages": {
                "within_100_ms": 100 * sum(error <= 100 for error in errors) / len(errors),
                "within_250_ms": 100 * sum(error <= 250 for error in errors) / len(errors),
                "within_500_ms": 100 * sum(error <= 500 for error in errors) / len(errors),
                "within_1000_ms": 100 * sum(error <= 1000 for error in errors) / len(errors),
                "over_1000_ms": 100 * sum(error > 1000 for error in errors) / len(errors),
            },
        },
    }
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


def word_tokens(text):
    return re.findall(r"[a-z0-9]+", text.lower().replace("’", "'"))


def convert_whisperx(args):
    candidate = json.loads(Path(args.base).read_text())
    aligned = json.loads(Path(args.aligned).read_text())
    words = [word for word in aligned["word_segments"] if "start" in word and "end" in word]
    for segment in candidate["segments"]:
        expected = word_tokens(segment["normalized_text"])[:8]
        if not expected:
            segment["alignment_quality"] = {"text_match": 0, "status": "unresolved"}
            continue
        coarse = segment["audio"]["start_ms"] / 1000
        nearby = [word for word in words if coarse - 8 <= word["start"] <= coarse + 8]
        best = None
        for index in range(len(nearby)):
            actual = word_tokens(" ".join(word["word"] for word in nearby[index:index + len(expected)]))
            score = difflib.SequenceMatcher(a=expected, b=actual).ratio()
            choice = (score, -abs(nearby[index]["start"] - coarse), index)
            if best is None or choice > best:
                best = choice
        if not best or best[0] < 0.5:
            segment["alignment_quality"] = {"text_match": best[0] if best else 0, "status": "unresolved"}
            continue
        matched = nearby[best[2]:best[2] + len(expected)]
        segment["audio"]["start_ms"] = round(matched[0]["start"] * 1000)
        segment["confidence"] = statistics.fmean(word.get("score", 0) for word in matched)
        segment["alignment_quality"] = {"text_match": best[0], "status": "aligned"}
    candidate["tool"] = args.tool
    candidate["state"] = "candidate"
    Path(args.output).write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n")


def prepare_mfa(args):
    candidate = json.loads(Path(args.candidate).read_text())
    text = " ".join(segment["normalized_text"] for segment in candidate["segments"] if word_tokens(segment["normalized_text"]))
    Path(args.output).write_text(text + "\n")


def prepare_mfa_windows(args):
    candidate = json.loads(Path(args.candidate).read_text())
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = []
    for segment in candidate["segments"]:
        if not word_tokens(segment["normalized_text"]):
            continue
        start = max(0, segment["audio"]["start_ms"] - args.padding_ms)
        end = segment["audio"]["end_ms"] + args.padding_ms
        name = f"{segment['sequence']:04d}"
        (output / f"{name}.lab").write_text(segment["normalized_text"] + "\n")
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-ss", str(start / 1000), "-to", str(end / 1000),
            "-i", args.audio, "-ar", "16000", "-ac", "1", str(output / f"{name}.wav"),
        ], check=True)
        manifest.append({"name": name, "segment_id": segment["id"], "offset_ms": start})
    Path(args.manifest).write_text(json.dumps(manifest, indent=2) + "\n")


def convert_mfa(args):
    candidate = json.loads(Path(args.base).read_text())
    by_id = {segment["id"]: segment for segment in candidate["segments"]}
    for entry in json.loads(Path(args.manifest).read_text()):
        grid = Path(args.textgrids, f"{entry['name']}.TextGrid")
        segment = by_id[entry["segment_id"]]
        if not grid.exists():
            segment["alignment_quality"] = {"status": "unresolved", "text_match": 0}
            continue
        words_tier = grid.read_text().split('item [2]:', 1)[0]
        intervals = re.findall(r'xmin = ([0-9.]+)\s+xmax = ([0-9.]+)\s+text = "([^"]*)"', words_tier)
        spoken = [(float(start), float(end), text) for start, end, text in intervals if text]
        if not spoken:
            segment["alignment_quality"] = {"status": "unresolved", "text_match": 0}
            continue
        expected = word_tokens(segment["normalized_text"])
        actual = word_tokens(" ".join(word for _, _, word in spoken))
        match = difflib.SequenceMatcher(a=expected, b=actual).ratio()
        segment["audio"]["start_ms"] = entry["offset_ms"] + round(spoken[0][0] * 1000)
        segment["confidence"] = None
        segment["alignment_quality"] = {"status": "aligned", "text_match": match}
        segment["word_timings"] = [
            {"word": word, "start": entry["offset_ms"] + round(start * 1000), "end": entry["offset_ms"] + round(end * 1000)}
            for start, end, word in spoken
        ]
    candidate["tool"] = "Montreal Forced Aligner 3.4.2.dev0 english_mfa + english_us_arpa"
    Path(args.output).write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n")


def boundary_analysis(args):
    anchors = json.loads(Path(args.anchors).read_text())["anchors"]
    evaluation = {row["anchor_id"]: row for row in json.loads(Path(args.evaluation).read_text())["anchors"]}
    aligned = json.loads(Path(args.aligned).read_text())
    words = [word for word in aligned["word_segments"] if "start" in word and "end" in word]
    with wave.open(args.wav, "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError("boundary analysis requires mono 16-bit PCM")
        rate = source.getframerate()
        samples = struct.unpack(f"<{source.getnframes()}h", source.readframes(source.getnframes()))

    def frame_db(timestamp_ms):
        start = max(0, round(timestamp_ms * rate / 1000))
        end = min(len(samples), start + round(rate / 100))
        rms = math.sqrt(sum(value * value for value in samples[start:end]) / max(1, end - start))
        return 20 * math.log10(max(rms, 1) / 32768)

    rows = []
    for anchor in anchors:
        golden = anchor["audio"]["timestamp_ms"]
        generated = evaluation[anchor["id"]]["generated_timestamp_ms"]
        word = min(words, key=lambda item: abs(round(item["start"] * 1000) - generated))
        word_start, word_end = round(word["start"] * 1000), round(word["end"] * 1000)
        segment = min(aligned["segments"], key=lambda item: abs(round(item["start"] * 1000) - word_start))
        characters = [item for item in segment.get("chars", []) if "start" in item and word_start <= round(item["start"] * 1000) < word_end]
        first_character_end = round(characters[0]["end"] * 1000) if characters else None

        frames = [(timestamp, frame_db(timestamp)) for timestamp in range(word_start - 500, word_start + 501, 10)]
        silence_runs, run = [], []
        for frame in frames:
            if frame[1] <= -50:
                run.append(frame)
            else:
                if len(run) >= 3:
                    silence_runs.append(run)
                run = []
        if len(run) >= 3:
            silence_runs.append(run)
        preceding = [run for run in silence_runs if run[-1][0] <= word_start]
        silence = preceding[-1] if preceding else None
        search_start = max(word_start - 100, silence[-1][0] + 10 if silence else word_start - 100)
        acoustic_onset = None
        for index, (timestamp, _) in enumerate(frames):
            if timestamp < search_start or timestamp > word_start + 200 or index + 2 >= len(frames):
                continue
            if all(frames[offset][1] > -40 for offset in range(index, index + 3)):
                acoustic_onset = timestamp
                break
        rows.append({
            "anchor_id": anchor["id"],
            "opening_text": " ".join(anchor["normalized_text"].split()[:8]),
            "golden_ms": golden,
            "word": word["word"].strip(),
            "word_start_ms": word_start,
            "word_end_ms": word_end,
            "first_ctc_character": characters[0]["char"] if characters else None,
            "first_ctc_character_end_ms": first_character_end,
            "acoustic_onset_ms": acoustic_onset,
            "preceding_silence_ms": (silence[-1][0] - silence[0][0] + 10) if silence else 0,
            "signed_error_ms": word_start - golden,
            "absolute_error_ms": abs(word_start - golden),
        })

    variants = {}
    for name, field in (("word_start", "word_start_ms"), ("first_ctc_character_end", "first_ctc_character_end_ms"), ("word_end", "word_end_ms"), ("acoustic_onset", "acoustic_onset_ms")):
        available = [row for row in rows if row[field] is not None]
        signed = [row[field] - row["golden_ms"] for row in available]
        absolute = [abs(value) for value in signed]
        variants[name] = {
            "anchors": len(available),
            "median_signed_error_ms": statistics.median(signed),
            "median_absolute_error_ms": statistics.median(absolute),
            "mean_absolute_error_ms": statistics.fmean(absolute),
            "maximum_absolute_error_ms": max(absolute),
            "within_250_ms": sum(value <= 250 for value in absolute),
            "over_1000_ms": sum(value > 1000 for value in absolute),
        }
    Path(args.output).write_text(json.dumps({
        "method": "WhisperX 3.8.6 CTC boundaries plus fixed 10 ms RMS onset detector",
        "acoustic_rule": "first three 10 ms frames above -40 dBFS, after the last >=30 ms run at or below -50 dBFS, within -100/+200 ms of CTC word start",
        "rows": rows,
        "variants": variants,
    }, ensure_ascii=False, indent=2) + "\n")


def evaluate_onsets(args):
    manual = {item["id"]: item for item in json.loads(Path(args.manual).read_text())["anchors"]}
    onset_fixture = json.loads(Path(args.onsets).read_text())
    measurements = {item["anchor_id"]: item for item in json.loads(Path(args.boundaries).read_text())["rows"]}
    if onset_fixture.get("semantics") != "earliest point at which the opening spoken word audibly begins" or len(onset_fixture.get("anchors", [])) != 10:
        raise ValueError("onset fixture must contain ten human audible-onset annotations")
    rows = []
    for onset in onset_fixture["anchors"]:
        anchor_id = onset["anchor_id"]
        source = manual.get(anchor_id)
        measurement = measurements.get(anchor_id)
        if not source or not measurement or onset["manual_seek_timestamp_ms"] != source["audio"]["timestamp_ms"]:
            raise ValueError(f"{anchor_id}: onset annotation does not match the immutable manual anchor")
        golden = onset["audible_onset_timestamp_ms"]
        row = {
            "anchor_id": anchor_id,
            "opening_word": onset["opening_word"],
            "manual_seek_timestamp_ms": onset["manual_seek_timestamp_ms"],
            "audible_onset_timestamp_ms": golden,
            "annotation_notes": onset["annotation_notes"],
        }
        for name, field in (("whisperx_word_start", "word_start_ms"), ("waveform_energy_onset", "acoustic_onset_ms")):
            generated = measurement[field]
            row[name] = {
                "generated_timestamp_ms": generated,
                "signed_error_ms": generated - golden,
                "absolute_error_ms": abs(generated - golden),
            }
        rows.append(row)

    def metrics(name):
        signed = [row[name]["signed_error_ms"] for row in rows]
        absolute = [abs(value) for value in signed]
        return {
            "median_signed_error_ms": statistics.median(signed),
            "median_absolute_error_ms": statistics.median(absolute),
            "mean_absolute_error_ms": statistics.fmean(absolute),
            "maximum_absolute_error_ms": max(absolute),
            "within_100_ms": sum(value <= 100 for value in absolute),
            "within_250_ms": sum(value <= 250 for value in absolute),
            "within_500_ms": sum(value <= 500 for value in absolute),
            "within_1000_ms": sum(value <= 1000 for value in absolute),
            "over_1000_ms": sum(value > 1000 for value in absolute),
        }
    Path(args.output).write_text(json.dumps({
        "onset_fixture": str(args.onsets),
        "rows": rows,
        "metrics": {name: metrics(name) for name in ("whisperx_word_start", "waveform_energy_onset")},
    }, ensure_ascii=False, indent=2) + "\n")


parser = argparse.ArgumentParser()
commands = parser.add_subparsers(required=True)
convert_parser = commands.add_parser("convert")
for name in ("epub", "audio", "aligned_epub", "transcript", "output"):
    convert_parser.add_argument(f"--{name.replace('_', '-')}", required=True)
convert_parser.set_defaults(run=convert)
evaluate_parser = commands.add_parser("evaluate")
for name in ("candidate", "anchors", "output"):
    evaluate_parser.add_argument(f"--{name}", required=True)
evaluate_parser.set_defaults(run=evaluate)
whisperx_parser = commands.add_parser("whisperx-convert")
for name in ("base", "aligned", "output", "tool"):
    whisperx_parser.add_argument(f"--{name}", required=True)
whisperx_parser.set_defaults(run=convert_whisperx)
mfa_parser = commands.add_parser("mfa-prepare")
mfa_parser.add_argument("--candidate", required=True)
mfa_parser.add_argument("--output", required=True)
mfa_parser.set_defaults(run=prepare_mfa)
mfa_windows = commands.add_parser("mfa-windows")
for name in ("candidate", "audio", "output", "manifest"):
    mfa_windows.add_argument(f"--{name}", required=True)
mfa_windows.add_argument("--padding-ms", type=int, default=1000)
mfa_windows.set_defaults(run=prepare_mfa_windows)
mfa_convert = commands.add_parser("mfa-convert")
for name in ("base", "manifest", "textgrids", "output"):
    mfa_convert.add_argument(f"--{name}", required=True)
mfa_convert.set_defaults(run=convert_mfa)
boundary = commands.add_parser("boundary")
for name in ("anchors", "evaluation", "aligned", "wav", "output"):
    boundary.add_argument(f"--{name}", required=True)
boundary.set_defaults(run=boundary_analysis)
onset_evaluate = commands.add_parser("onset-evaluate")
for name in ("manual", "onsets", "boundaries", "output"):
    onset_evaluate.add_argument(f"--{name}", required=True)
onset_evaluate.set_defaults(run=evaluate_onsets)
arguments = parser.parse_args()
arguments.run(arguments)
