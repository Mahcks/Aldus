#!/usr/bin/env python3
"""Identify an exact release-prepare commit; everything else needs full CI."""

import re
import subprocess
import sys

PIN_FILES = {
    '.env.example',
    'demo/.env.example',
    'README.md',
    'docs/src/content/docs/admin/install.mdx',
    'docs/src/content/docs/admin/backups.mdx',
}
VERSION = re.compile(rb'^ALDUS_VERSION=([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$', re.M)


def git(*args):
    return subprocess.check_output(['git', *args])


def eligible_parent(ref='HEAD'):
    parents = git('rev-list', '--parents', '-n', '1', ref).decode().split()
    if len(parents) != 2:
        return ''
    head, parent = parents
    changes = git('diff', '--no-renames', '--raw', parent, head).decode().splitlines()
    if not changes:
        return ''
    for change in changes:
        metadata, path = change.split('\t', 1)
        old_mode, new_mode, _, _, status = metadata.split()
        if path not in PIN_FILES or status != 'M' or old_mode[1:] != new_mode:
            return ''

    def content(commit, path):
        return git('show', f'{commit}:{path}')

    old = VERSION.findall(content(parent, '.env.example'))
    new = VERSION.findall(content(head, '.env.example'))
    if len(old) != 1 or len(new) != 1 or old == new:
        return ''
    for path in PIN_FILES:
        before = content(parent, path)
        after = content(head, path)
        # Deliberately require consistent parent pins. Unusual prep needs full CI.
        if old[0] not in before or before.replace(old[0], new[0]) != after:
            return ''
    return parent


if __name__ == '__main__':
    print(eligible_parent(sys.argv[1] if len(sys.argv) > 1 else 'HEAD'))
