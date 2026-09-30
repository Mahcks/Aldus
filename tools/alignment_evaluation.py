"""Fixture identity and conservative, occurrence-aware benchmark matching."""

import math
import re
import statistics


def bound_fixtures(left, right):
    for field in ("epub_sha256", "audio_sha256"):
        digest = left.get(field)
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or digest != right.get(field):
            raise ValueError(f"fixture {field} mismatch")
    if left.get("fixture_id") and right.get("fixture_id") and left["fixture_id"] != right["fixture_id"]:
        raise ValueError("fixture ID mismatch")


def unique(items, key):
    result = {}
    for item in items:
        identity = item.get(key)
        if not isinstance(identity, str) or not identity or identity in result:
            raise ValueError(f"missing or duplicate {key}")
        result[identity] = item
    return result


def timestamp(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError("invalid timestamp")
    return value


def boundary(value):
    if not isinstance(value, dict) or not isinstance(value.get("dom_path"), str) or not value["dom_path"]:
        raise ValueError("missing DOM boundary")
    offset = value.get("node_offset")
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("invalid DOM offset")
    return value["dom_path"], offset


def same_range(left, right):
    return (left.get("href") == right.get("href") and
            boundary(left.get("start")) == boundary(right.get("start")) and
            boundary(left.get("end")) == boundary(right.get("end")))


def exact_segment(anchor, segment):
    expected = anchor["epub"]
    actual = segment["epub"]
    if actual.get("href") != expected.get("href"):
        return False
    if anchor.get("expected_match", True) and anchor["normalized_text"] != segment.get("normalized_text", " ".join(segment.get("text", "").split())):
        return False
    if actual.get("start") is not None and actual.get("end") is not None:
        return same_range(expected, actual)
    # Production artifacts describe whole DOM elements. Require that element's
    # complete text and both selection boundaries inside it, never a substring.
    path = actual.get("dom_path") or actual.get("locator", {}).get("dom_path")
    return bool(path and all(boundary(expected.get(edge))[0].startswith(path + "/") for edge in ("start", "end")))


def evaluate_anchors(candidate, golden):
    bound_fixtures(candidate, golden)
    anchors = unique(golden["anchors"], "id")
    if not anchors:
        raise ValueError("anchor fixture is empty")
    segments = unique(candidate["segments"], "id")
    rows = []
    for anchor in anchors.values():
        boundary(anchor.get("epub", {}).get("start"))
        boundary(anchor.get("epub", {}).get("end"))
        matches = [segment for segment in segments.values() if exact_segment(anchor, segment)]
        row = {"anchor_id": anchor["id"], "segment_id": None, "generated_timestamp_ms": None,
               "absolute_error_ms": None, "restored_text_match": False, "confidence": None,
               "expected_match": anchor.get("expected_match", True)}
        if not isinstance(row["expected_match"], bool):
            raise ValueError("expected_match must be boolean")
        if row["expected_match"]:
            row["manual_timestamp_ms"] = timestamp(anchor["audio"]["timestamp_ms"])
        if len(matches) != 1:
            row["status"] = "ambiguous" if matches else "unresolved"
        else:
            segment = matches[0]
            quality = segment.get("status", segment.get("alignment_quality", {}).get("status", "aligned"))
            row["segment_id"] = segment["id"]
            if quality != "aligned" or segment.get("highlightable") is False:
                row["status"] = "unresolved"
            else:
                generated = timestamp(segment["audio"]["start_ms"])
                row.update(status="matched", generated_timestamp_ms=generated,
                           restored_text_match=True, confidence=segment.get("confidence"))
                if row["expected_match"]:
                    row["absolute_error_ms"] = abs(generated - row["manual_timestamp_ms"])
        if not row["expected_match"]:
            # Ambiguous location cannot establish safe refusal either.
            row["negative_pass"] = row["status"] == "unresolved"
        rows.append(row)
    return rows


def error_metrics(errors):
    ordered = sorted(errors)
    count = len(errors)
    return {
        "measured_anchors": count,
        "median_absolute_error_ms": statistics.median(errors) if count else None,
        "mean_absolute_error_ms": statistics.fmean(errors) if count else None,
        "p95_absolute_error_ms": ordered[math.ceil(.95 * count) - 1] if count else None,
        "maximum_absolute_error_ms": max(errors) if count else None,
        **{f"within_{limit}_ms": sum(value <= limit for value in errors) for limit in (100, 250, 500, 1000)},
        "over_1000_ms": sum(value > 1000 for value in errors),
    }
