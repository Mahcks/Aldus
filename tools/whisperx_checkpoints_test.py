import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from whisperx_checkpoints import Checkpoints, fingerprint


class CheckpointTest(unittest.TestCase):
    def test_atomic_checkpoint_ignores_partial_corrupt_wrong_stage_and_stale_files(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoints(Path(directory) / "alignment.json", "sources-and-model")
            payload = {"segments": [{"text": "hello", "start": 0, "end": 1}]}
            checkpoint.save("transcription", payload)
            path = checkpoint.directory / "transcription.json"
            original = path.read_bytes()
            self.assertEqual(checkpoint.load("transcription"), payload)
            path.with_suffix(".tmp").write_text("interrupted write")
            self.assertEqual(checkpoint.load("transcription"), payload)
            stale = Checkpoints(Path(directory) / "alignment.json", "changed-source")
            self.assertIsNone(stale.load("transcription"))
            (checkpoint.directory / "word-timings.json").write_bytes(original)
            self.assertIsNone(checkpoint.load("word-timings"))
            for invalid in (b"{", b"null", b"[]", original.replace(b"hello", b"wrong")):
                path.write_bytes(invalid)
                self.assertIsNone(checkpoint.load("transcription"))
            checkpoint.save("transcription", payload)
            self.assertEqual(checkpoint.load("transcription"), payload)
            self.assertFalse(path.with_suffix(".tmp").exists())

    def test_identity_binds_sources_text_model_settings_and_dependencies(self):
        job = {"epub_sha256": "ebook", "audio_sha256": "audio", "model": "base.en", "segments": []}
        settings = ["cpu", "int8", 4]
        with patch("whisperx_checkpoints.importlib.metadata.version", return_value="1"):
            expected = fingerprint(job, settings)
            self.assertEqual(expected, fingerprint(dict(job), list(settings)))
            for key in job:
                self.assertNotEqual(expected, fingerprint({**job, key: "changed"}, settings))
            self.assertNotEqual(expected, fingerprint(job, ["cuda", "float16", 4]))
            self.assertNotEqual(expected, fingerprint(job, ["cpu", "int8", 1]))
        with patch("whisperx_checkpoints.importlib.metadata.version", return_value="2"):
            self.assertNotEqual(expected, fingerprint(job, settings))

    def test_failed_replace_preserves_previous_complete_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoints(Path(directory) / "alignment.json", "identity")
            payload = {"segments": []}
            checkpoint.save("transcription", payload)
            with patch("whisperx_checkpoints.Path.replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    checkpoint.save("transcription", {"segments": [{"text": "new"}]})
            self.assertEqual(checkpoint.load("transcription"), payload)


class WorkerResumeTest(unittest.TestCase):
    def test_interrupted_worker_reuses_completed_stages_and_matches_fresh_output(self):
        from contextlib import ExitStack
        from types import SimpleNamespace
        from unittest.mock import Mock
        import whisperx_worker

        job = {
            "version": 1,
            "audio_path": "/verified/audio.m4b",
            "audio_resource": "audio.m4b",
            "epub_sha256": "ebook-hash",
            "audio_sha256": "audio-hash",
            "model": "base.en",
            "segments": [{"id": "s1", "ordinal": 0, "text": "hello world", "href": "chapter.xhtml", "dom_path": "p[1]"}],
        }
        speech = {"segments": [{"text": "hello world", "start": 0, "end": 1}]}
        timings = {"word_segments": [
            {"word": "hello", "start": 0, "end": 0.4, "score": 0.9},
            {"word": "world", "start": 0.5, "end": 1, "score": 0.9},
        ]}
        model = SimpleNamespace(transcribe=Mock(return_value=speech))
        worker = SimpleNamespace(
            load_audio=Mock(return_value=[0]),
            load_model=Mock(return_value=model),
            load_align_model=Mock(return_value=(None, {"type": "test"})),
            align=Mock(return_value=timings),
        )
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory)
            source = root / "input.json"
            source.write_text(json.dumps(job))
            output = root / "alignment.json"
            stack.enter_context(patch.dict("sys.modules", {"whisperx": worker}))
            stack.enter_context(patch("sys.argv", ["worker", "--job-input", str(source), "--output", str(output)]))
            stack.enter_context(patch("whisperx_worker.importlib.metadata.version", return_value="test"))
            stack.enter_context(patch("whisperx_worker.load_worker_config", return_value=("cpu", "int8", 4)))
            stack.enter_context(patch.dict("os.environ", {"ALDUS_PROGRESS_PATH": str(root / "progress.json")}))
            worker.load_align_model.side_effect = RuntimeError("interrupted after transcription")
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                whisperx_worker.main()
            self.assertFalse(output.exists())
            self.assertEqual(model.transcribe.call_count, 1)

            worker.load_align_model.side_effect = None
            with patch("whisperx_worker.canonical_words", side_effect=RuntimeError("interrupted after word timing")):
                with self.assertRaisesRegex(RuntimeError, "interrupted"):
                    whisperx_worker.main()
            self.assertFalse(output.exists())
            self.assertEqual(model.transcribe.call_count, 1)
            self.assertEqual(worker.align.call_count, 1)

            audio_loads = worker.load_audio.call_count
            whisperx_worker.main()
            resumed = json.loads(output.read_text())
            self.assertEqual(worker.load_audio.call_count, audio_loads)
            self.assertEqual(model.transcribe.call_count, 1)
            self.assertEqual(worker.align.call_count, 1)
            self.assertEqual(json.loads((root / "runtime.json").read_text())["resumed_stages"], ["word-timings"])

            for checkpoint in (root / "checkpoints").iterdir():
                checkpoint.unlink()
            whisperx_worker.main()
            self.assertEqual(json.loads(output.read_text()), resumed)
            self.assertEqual(model.transcribe.call_count, 2)
            self.assertEqual(worker.align.call_count, 2)
