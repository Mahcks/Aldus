"""Job-local, atomic checkpoints. Never a substitute for server artifact validation."""

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path

MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")


def fingerprint(job, settings):
    source = Path(__file__).parent
    versions = {
        name: importlib.metadata.version(name)
        for name in ("whisperx", "torch", "torchaudio", "ctranslate2", "faster-whisper", "transformers")
    }
    scripts = {
        name: hashlib.sha256((source / name).read_bytes()).hexdigest()
        for name in ("whisperx_worker.py", "whisperx_worker_config.py", "whisperx_checkpoints.py")
    }
    identity = {"schema": 1, "job": job, "settings": settings, "versions": versions, "scripts": scripts}
    return hashlib.sha256(encoded(identity)).hexdigest()


class Checkpoints:
    def __init__(self, output, identity):
        self.directory = Path(output).parent / "checkpoints"
        self.identity = identity

    def load(self, stage):
        path = self.directory / (stage + ".json")
        try:
            with path.open("rb") as checkpoint:
                data = checkpoint.read(MAX_CHECKPOINT_BYTES + 1)
            if len(data) > MAX_CHECKPOINT_BYTES:
                return None
            value = json.loads(data)
            if value["identity"] != self.identity or value["stage"] != stage:
                return None
            payload = value["payload"]
            key = "segments" if stage == "transcription" else "word_segments"
            if not isinstance(payload, dict) or not isinstance(payload.get(key), list):
                return None
            if not all(isinstance(item, dict) for item in payload[key]):
                return None
            if hashlib.sha256(encoded(payload)).hexdigest() != value["sha256"]:
                return None
            return payload
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def save(self, stage, payload):
        digest = hashlib.sha256(encoded(payload)).hexdigest()
        data = encoded({"identity": self.identity, "stage": stage, "sha256": digest, "payload": payload})
        if len(data) > MAX_CHECKPOINT_BYTES:
            raise ValueError("alignment checkpoint exceeds size limit")
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / (stage + ".json")
        temporary = path.with_suffix(".tmp")
        with temporary.open("wb") as checkpoint:
            checkpoint.write(data)
            checkpoint.flush()
            os.fsync(checkpoint.fileno())
        temporary.replace(path)
        descriptor = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
