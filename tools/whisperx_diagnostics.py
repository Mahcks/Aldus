"""Best-effort stage diagnostics that survive an ungraceful worker exit."""

import json
import os
import sys
import time
from pathlib import Path


class StageDiagnostics:
    def __init__(self, path):
        self.path = Path(path)
        self.started = time.monotonic()
        self.stage_started = self.started
        self.data = {"state": "running", "started_at": time.time(), "stages": []}

    def __enter__(self):
        self.persist()
        return self

    def stage(self, name):
        self.complete_stage()
        self.stage_started = time.monotonic()
        self.data["active_stage"] = name
        self.data["stage_started_at"] = time.time()
        self.persist()

    def details(self, **values):
        self.data.update(values)
        self.persist()

    def complete_stage(self):
        name = self.data.pop("active_stage", None)
        if name:
            self.data["stages"].append({
                "name": name,
                "seconds": time.monotonic() - self.stage_started,
            })
        self.data.pop("stage_started_at", None)

    def persist(self):
        try:
            self.data["updated_at"] = time.time()
            self.data["elapsed_seconds"] = time.monotonic() - self.started
            try:
                import resource
                peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                self.data["peak_rss_bytes"] = peak if sys.platform == "darwin" else peak * 1024
            except ImportError:
                pass
            temporary = self.path.with_suffix(".tmp")
            with temporary.open("w") as output:
                json.dump(self.data, output, allow_nan=False)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.path)
        except (OSError, ValueError):
            pass  # Diagnostics must never prevent alignment or recovery.

    def __exit__(self, error_type, error, traceback):
        if error_type is None:
            self.complete_stage()
            self.data["state"] = "complete"
        else:
            self.data["state"] = "failed"
            self.data["error_type"] = error_type.__name__
        self.persist()
