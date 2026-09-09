import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from whisperx_diagnostics import StageDiagnostics


class DiagnosticsTest(unittest.TestCase):
    def test_stage_boundaries_success_failure_and_unwritable_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stages.json"
            with patch("whisperx_diagnostics.time.monotonic", return_value=10) as clock:
                with StageDiagnostics(path) as diagnostics:
                    diagnostics.stage("transcribing")
                    clock.return_value = 14
                    diagnostics.stage("aligning_words")
                    saved = json.loads(path.read_text())
                    self.assertEqual(saved["stages"], [{"name": "transcribing", "seconds": 4}])
                    self.assertEqual(saved["active_stage"], "aligning_words")
                self.assertEqual(json.loads(path.read_text())["state"], "complete")
            with self.assertRaises(ValueError):
                with StageDiagnostics(path) as diagnostics:
                    diagnostics.stage("transcribing")
                    raise ValueError("private input must not be logged")
            saved = json.loads(path.read_text())
            self.assertEqual(saved["state"], "failed")
            self.assertEqual(saved["active_stage"], "transcribing")
            self.assertEqual(saved["error_type"], "ValueError")
            self.assertNotIn("private input", path.read_text())
            with StageDiagnostics(path / "missing" / "stages.json") as diagnostics:
                diagnostics.stage("transcribing")

    def test_killed_worker_leaves_last_stage_on_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stages.json"
            script = """
import sys
from whisperx_diagnostics import StageDiagnostics
with StageDiagnostics(sys.argv[1]) as diagnostics:
    diagnostics.stage('transcribing')
    print('ready', flush=True)
    sys.stdin.read()
"""
            with subprocess.Popen(
                [sys.executable, "-c", script, str(path)],
                cwd=Path(__file__).parent,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                text=True,
            ) as process:
                try:
                    self.assertEqual(process.stdout.readline().strip(), "ready")
                finally:
                    process.kill()
                    process.wait(timeout=5)
            saved = json.loads(path.read_text())
            self.assertEqual(saved["state"], "running")
            self.assertEqual(saved["active_stage"], "transcribing")
            self.assertIn("stage_started_at", saved)


class ModelLifetimeTest(unittest.TestCase):
    def test_models_are_released_before_next_stage(self):
        import weakref
        from types import SimpleNamespace
        import whisperx_worker

        references = {}

        class Model:
            def transcribe(self, audio, **kwargs):
                return {"segments": []}

        def load_model(*args, **kwargs):
            model = Model()
            references["asr"] = weakref.ref(model)
            return model

        def load_align_model(**kwargs):
            self.assertIsNone(references["asr"]())
            model = Model()
            references["ctc"] = weakref.ref(model)
            return model, {}

        def write(*args):
            self.assertIsNone(references["asr"]())
            self.assertIsNone(references["ctc"]())

        worker = SimpleNamespace(
            load_audio=lambda path: [],
            load_model=load_model,
            load_align_model=load_align_model,
            align=lambda *args, **kwargs: {"word_segments": []},
        )
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.dict("sys.modules", {"whisperx": worker}),
                patch("sys.argv", ["worker", "--audio", "fixture.mp3", "--output", str(Path(directory) / "alignment.json")]),
                patch("whisperx_worker.load_worker_config", return_value=("cpu", "int8", 4)),
                patch("whisperx_worker.importlib.metadata.version", return_value="test"),
                patch("whisperx_worker.write", side_effect=write),
            ):
                whisperx_worker.main()
