"""Check bounded image-download retries without downloading models."""
from pathlib import Path
import subprocess


def test_preload_retries():
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    preload = dockerfile.split("# Preload the shared models", 1)[1].split("RUN <<'SH'\n", 1)[1].split("\nSH", 1)[0]
    for succeed_at, expected_status, expected_calls in [(1, 0, 1), (3, 0, 3), (4, 1, 3)]:
        mocks = f"""
calls=0
python() {{ cat >/dev/null; calls=$((calls + 1)); test "$calls" -ge {succeed_at}; }}
sleep() {{ :; }}
chown() {{ :; }}
trap 'echo "$calls"' EXIT
"""
        result = subprocess.run(["sh"], input=mocks + preload, text=True, capture_output=True)
        assert result.returncode == expected_status, result
        assert result.stdout.strip() == str(expected_calls), result


if __name__ == "__main__":
    test_preload_retries()
    print("Model preload retry checks passed")
