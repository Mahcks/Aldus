#!/usr/bin/env python3
"""Exercise the release shortcut against real Git commits, without GitHub."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('release_prep', Path(__file__).with_name('release-prep-ci.py'))
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL).decode().strip()


original = Path.cwd()
with tempfile.TemporaryDirectory() as directory:
    os.chdir(directory)
    try:
        git('init')
        git('config', 'user.email', 'test@example.invalid')
        git('config', 'user.name', 'Test')
        for name in prep.PIN_FILES:
            path = Path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('ALDUS_VERSION=0.1.0-beta.20\n' if name.endswith('.env.example') else 'Install 0.1.0-beta.20\n')
        Path('server.go').write_text('original\n')
        git('add', '.')
        git('commit', '-qm', 'base')
        base = git('rev-parse', 'HEAD')
        assert prep.eligible_parent() == ''  # Root commits cannot reuse checks.

        for name in prep.PIN_FILES:
            path = Path(name)
            path.write_text(path.read_text().replace('0.1.0-beta.20', '0.1.0-beta.21'))
        git('commit', '-qam', 'prepare')
        prepared = git('rev-parse', 'HEAD')
        assert prep.eligible_parent() == base

        for path, text in [('.env.example', 'ALDUS_BIND_HOST=0.0.0.0\n'),
                           ('README.md', 'Unrelated documentation change\n'),
                           ('server.go', 'changed code\n'),
                           ('new-file', 'new\n')]:
            git('reset', '--hard', prepared)
            with Path(path).open('a') as file:
                file.write(text)
            git('add', '.')
            git('commit', '--amend', '--no-edit', '-q')
            assert prep.eligible_parent() == '', path
            git('reset', '--hard', prepared)

        Path('README.md').write_text('Install 0.1.0-beta.20\n')
        git('commit', '--amend', '--no-edit', '-qa')
        assert prep.eligible_parent() == ''  # Incomplete preparation is not eligible.
        git('reset', '--hard', prepared)
        Path('README.md').unlink()
        git('commit', '--amend', '--no-edit', '-qa')
        assert prep.eligible_parent() == ''
        git('reset', '--hard', prepared)
        Path('README.md').chmod(0o755)
        git('commit', '--amend', '--no-edit', '-qa')
        assert prep.eligible_parent() == ''  # Even file-mode changes need full CI.
        git('reset', '--hard', prepared)
        git('commit', '--allow-empty', '-qm', 'empty')
        assert prep.eligible_parent() == ''
    finally:
        os.chdir(original)
print('release-prep CI checks passed')
