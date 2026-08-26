#!/bin/sh
set -eu

mkdir -p "$ALDUS_ALIGNMENT_MODEL_DIR"
cp -an /opt/aldus-models/. "$ALDUS_ALIGNMENT_MODEL_DIR/"
exec aldus "$@"
