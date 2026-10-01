import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import math
import unittest

from whisperx_worker import canonical_words, report_stage


class ProgressTest(unittest.TestCase):
    def test_atomic_stage_and_unavailable_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            with patch.dict(os.environ, {"ALDUS_PROGRESS_PATH": str(path)}):
                report_stage("transcribing")
                self.assertEqual(json.loads(path.read_text()), {"stage": "transcribing"})
                self.assertFalse(Path(str(path) + ".tmp").exists())
                report_stage("matching_text")
                self.assertEqual(json.loads(path.read_text()), {"stage": "matching_text"})
            with patch.dict(os.environ, {"ALDUS_PROGRESS_PATH": str(path / "missing")}):
                report_stage("transcribing")  # Telemetry must not stop alignment.


class WordTimingTest(unittest.TestCase):
    def test_maps_whisperx_words_without_reordering_them(self):
        self.assertEqual(
            canonical_words(
                [
                    {"word": "one", "start": 1.0, "end": 1.4, "score": 0.8},
                    {"word": "two", "start": 1.5, "end": 1.5},
                ]
            ),
            [
                {"text": "one", "startTime": 1.0, "endTime": 1.4, "confidence": 0.8},
                {"text": "two", "startTime": 1.5, "endTime": 1.5},
            ],
        )

    def test_rejects_incomplete_or_invalid_words(self):
        invalid = [
            {"start": 1.0, "end": 1.4},
            {"word": "one", "end": 1.4},
            {"word": "one", "start": 1.0},
            {"word": "", "start": 1.0, "end": 1.4},
            {"word": "one", "start": 1.0, "end": 0.9},
            {"word": "one", "start": math.inf, "end": math.inf},
            {"word": "one", "start": 1.0, "end": 1.4, "score": math.inf},
        ]
        for word in invalid:
            with self.subTest(word=word), self.assertRaises(ValueError):
                canonical_words([word])


class OpeningConfidenceTest(unittest.TestCase):
    def test_chapter_markers_keep_the_first_part_of_a_split_chapter(self):
        from types import SimpleNamespace
        from whisperx_worker import chapter_markers

        probe = {"chapters": [
            {"start_time": "8853.019546", "tags": {"title": "10 - Chapter 6"}},
            {"start_time": "31790.004717", "tags": {"title": "28 - Chapter 24: Part 1"}},
            {"start_time": "33230.008073", "tags": {"title": "29 - Chapter 24: Part 2"}},
        ]}
        with patch("whisperx_worker.subprocess.run", return_value=SimpleNamespace(stdout=json.dumps(probe).encode())):
            self.assertEqual(chapter_markers("book.m4b"), {"Chapter 6": 8853020, "Chapter 24": 31790005})

    def test_chapter_marker_rejects_prior_chapter_credit_as_heading(self):
        from contextlib import ExitStack
        from types import SimpleNamespace
        from unittest.mock import Mock
        import whisperx_worker

        job = {
            "version": 1, "audio_path": "/frozen/book.m4b", "audio_resource": "book.m4b",
            "epub_sha256": "epub", "audio_sha256": "audio", "model": "base.en",
            "segments": [
                {"id": "heading", "ordinal": 0, "text": "Chapter 6", "href": "book.xhtml", "dom_path": "h2[1]"},
                {"id": "prose", "ordinal": 1, "text": "Clerval then put the letter", "href": "book.xhtml", "dom_path": "p[1]"},
            ],
        }
        words = [
            {"word": word, "start": start, "end": start + 0.2, "score": 0.9}
            for word, start in zip(
                "Chapter 6 Clerval then put the letter".split(),
                (100.0, 100.3, 120.0, 120.3, 120.6, 120.9, 121.2),
            )
        ]
        worker = SimpleNamespace(
            load_audio=Mock(return_value=[]),
            load_model=Mock(return_value=SimpleNamespace(transcribe=Mock(return_value={"segments": []}))),
            load_align_model=Mock(return_value=(None, {})),
            align=Mock(return_value={"word_segments": words}),
        )
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            source = Path(directory) / "input.json"
            output = Path(directory) / "alignment.json"
            source.write_text(json.dumps(job))
            stack.enter_context(patch.dict("sys.modules", {"whisperx": worker}))
            stack.enter_context(patch("sys.argv", ["worker", "--job-input", str(source), "--output", str(output)]))
            stack.enter_context(patch("whisperx_worker.importlib.metadata.version", return_value="test"))
            stack.enter_context(patch("whisperx_worker.load_worker_config", return_value=("cpu", "int8", 4)))
            stack.enter_context(patch("whisperx_worker.chapter_markers", return_value={"Chapter 6": 110000}))
            stack.enter_context(patch("whisperx_worker.recover_weak_starts"))
            whisperx_worker.main()
            segments = json.loads(output.read_text())["segments"]
        self.assertEqual(segments[0]["status"], "unresolved")
        self.assertFalse(segments[0]["highlightable"])
        self.assertEqual(segments[1]["status"], "aligned")

    def test_full_worker_refuses_reviewed_bad_start_and_keeps_confirmed_starts(self):
        from contextlib import ExitStack
        from types import SimpleNamespace
        from unittest.mock import Mock
        import whisperx_worker

        fixture = json.loads((Path(__file__).resolve().parents[1] / "test-fixtures/alignment-corpus/alice-opening-review.json").read_text())
        samples = fixture["samples"]
        job = {
            "version": 1, "audio_path": "/frozen/alice.m4b", "audio_resource": "alice.m4b",
            "epub_sha256": fixture["epub_sha256"], "audio_sha256": fixture["audio_sha256"],
            "model": "base.en", "segments": [
                {"id": item["segment_id"], "ordinal": index, "text": item["text"],
                 "href": f"chapter-{index}.xhtml", "dom_path": "html[1]/body[1]/p[1]"}
                for index, item in enumerate(samples)
            ],
        }
        timings = {"word_segments": [word for item in samples for word in item["words"]]}
        worker = SimpleNamespace(
            load_audio=Mock(return_value=[]),
            load_model=Mock(return_value=SimpleNamespace(transcribe=Mock(return_value={"segments": []}))),
            load_align_model=Mock(return_value=(None, {})),
            align=Mock(return_value=timings),
        )
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            source = Path(directory) / "input.json"
            output = Path(directory) / "alignment.json"
            source.write_text(json.dumps(job))
            stack.enter_context(patch.dict("sys.modules", {"whisperx": worker}))
            stack.enter_context(patch("sys.argv", ["worker", "--job-input", str(source), "--output", str(output)]))
            stack.enter_context(patch("whisperx_worker.importlib.metadata.version", return_value="test"))
            stack.enter_context(patch("whisperx_worker.load_worker_config", return_value=("cpu", "int8", 4)))
            stack.enter_context(patch("whisperx_worker.recover_weak_starts"))
            whisperx_worker.main()
            segments = json.loads(output.read_text())["segments"]
        for sample, segment in zip(samples, segments):
            with self.subTest(segment=sample["segment_id"]):
                accepted = sample["review"]["result"] == "right"
                self.assertEqual(segment["status"], "aligned" if accepted else "unresolved")
                self.assertEqual(segment["highlightable"], accepted)
                self.assertEqual(segment["audio"]["start_ms"], round(sample["words"][0]["start"] * 1000))
        failed = segments[-1]["confidence_signals"]
        self.assertGreaterEqual(failed["mean_word_score"], 0.5)
        self.assertLess(failed["opening_word_score"], 0.5)
        self.assertTrue(failed["opening_word_matched"])

    def test_opening_evidence_requires_scores_and_ignores_a_strong_later_tail(self):
        from whisperx_worker import opening_word_score
        self.assertIsNone(opening_word_score([]))
        self.assertIsNone(opening_word_score([{"confidence": 0.9}, {}]))
        self.assertEqual(opening_word_score([{"confidence": 0.9}]), 0.9)
        weak = [{"confidence": 0.4}] * 10 + [{"confidence": 1}] * 100
        self.assertAlmostEqual(opening_word_score(weak), 0.4)


class OpeningRecoveryTest(unittest.TestCase):
    def test_short_window_search_requires_one_exact_opening(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        from whisperx_worker import recovery_opening

        text = "Here cried Alice quite forgetting in the flurry of the moment"
        phrase = SimpleNamespace(words=[
            SimpleNamespace(word=word, start=3.22 + index * 0.3)
            for index, word in enumerate(text.split())
        ])
        audio = [0] * (45 * 16000)
        model = Mock()
        model.transcribe.side_effect = [([], None), ([], None), ([phrase], None), ([], None), ([], None)]
        self.assertAlmostEqual(recovery_opening(model, audio, text), 18.22)
        model.transcribe.side_effect = [([phrase], None), ([], None), ([phrase], None), ([], None), ([], None)]
        self.assertIsNone(recovery_opening(model, audio, text))
        model.transcribe.side_effect = [([], None)] * 5
        self.assertIsNone(recovery_opening(model, audio, text))

    def test_recovery_is_bounded_and_leaves_accepted_passages_untouched(self):
        import copy
        from types import SimpleNamespace
        from unittest.mock import Mock
        from whisperx_worker import recover_weak_starts

        text = "Here cried Alice quite forgetting in the flurry of the moment"
        segments = []
        for index in range(10):
            segments.append({
                "text": text, "status": "unresolved", "highlightable": False,
                "audio": {"start_ms": index * 100000 + 5000, "end_ms": index * 100000 + 40000},
                "word_timings": [{"text": "old"}],
                "confidence_signals": {
                    "opening_word_matched": True, "text_coverage": 1,
                    "mean_word_score": 0.7, "opening_word_score": 0.4,
                },
            })
        # A missing first sentence must be retried despite confident later words.
        segments[1]["confidence_signals"].update(
            opening_word_matched=False, text_coverage=0.58, opening_word_score=0.83,
        )
        segments[-1]["status"] = "aligned"
        segments[-1]["highlightable"] = True
        before = copy.deepcopy(segments)
        result = {"word_segments": [
            {"word": word, "start": 18.6 + index * 0.5,
             "end": 19 + index * 0.5, "score": 0.8}
            for index, word in enumerate(text.split())
        ]}
        numpy = Mock()
        numpy.frombuffer.return_value.copy.return_value = [0] * (40 * 16000)
        whisper = SimpleNamespace(WhisperModel=Mock())
        whisperx = SimpleNamespace(load_align_model=Mock(return_value=(None, {})), align=Mock(return_value=result))
        job = {"model": "base.en", "audio_path": "frozen.m4b", "audio_duration_ms": 1000000}
        with patch.dict("sys.modules", {"numpy": numpy, "whisperx": whisperx, "faster_whisper": whisper}), \
             patch("whisperx_worker.subprocess.run", return_value=SimpleNamespace(stdout=b"")) as decode, \
             patch("whisperx_worker.recovery_opening", return_value=18.22):
            recover_weak_starts(segments, job, "cpu", "int8", Mock())
        self.assertEqual(decode.call_count, 8)
        command = decode.call_args_list[1].args[0]
        self.assertEqual(command[command.index("-ss") + 1], "75.0")
        self.assertEqual(segments[8:], before[8:])
        for index, segment in enumerate(segments[:8]):
            self.assertEqual(segment["status"], "aligned")
            self.assertTrue(segment["highlightable"])
            self.assertTrue(segment["confidence_signals"]["opening_recovered"])
            self.assertTrue(segment["confidence_signals"]["opening_word_matched"])
            expected = 93600 if index == 1 else index * 100000 + 18600
            self.assertEqual(segment["audio"]["start_ms"], expected)

    def test_realign_accepts_only_complete_confident_bounded_words(self):
        import copy
        from whisperx_worker import recovered_words

        text = "Here cried Alice quite forgetting in the flurry of the moment"
        result = {"word_segments": [
            {"word": word, "start": 18.601 + index * 0.5,
             "end": 19 + index * 0.5, "score": 0.8}
            for index, word in enumerate(text.split())
        ]}
        offset = 11842.523
        def recover(value, **overrides):
            bounds = {"opening": 18.22, "lower_ms": 11842523, "upper_ms": 11870000}
            bounds.update(overrides)
            return recovered_words(value, text, offset, **bounds)

        words = recover(result)
        self.assertEqual(round(words[0]["startTime"] * 1000), 11861124)
        self.assertIsNone(recover(result, opening=2))
        self.assertIsNone(recover(result, upper_ms=11862000))
        self.assertIsNone(recover(result, lower_ms=11862000))
        for mutation in ("weak", "missing_score", "missing_time", "wrong_text", "overlap"):
            bad = copy.deepcopy(result)
            first = bad["word_segments"][0]
            if mutation == "weak":
                for word in bad["word_segments"][:10]:
                    word["score"] = 0.4
            elif mutation == "missing_score":
                del first["score"]
            elif mutation == "missing_time":
                del first["start"]
            elif mutation == "wrong_text":
                first["word"] = "Chapter"
            else:
                bad["word_segments"][1]["start"] = first["start"]
            with self.subTest(mutation=mutation):
                self.assertIsNone(recover(bad))


class AcceleratorTest(unittest.TestCase):
    def test_detected_gpu_without_working_kernels_fails_early(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        from whisperx_worker import require_accelerator

        torch = SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: True),
            ones=Mock(side_effect=RuntimeError("no kernel image")),
        )
        with patch.dict("sys.modules", {"torch": torch}):
            with self.assertRaises(SystemExit) as raised:
                require_accelerator("cuda")
            self.assertEqual(raised.exception.code, 78)


if __name__ == "__main__":
    unittest.main()
