#!/bin/sh
set -eu

install -d -o aldus -g aldus /data/aldus /data/demo-media
exec su-exec aldus "$@"
