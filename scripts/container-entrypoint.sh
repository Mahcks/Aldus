#!/bin/sh
set -eu

case ${1:-} in
  backup|restore|reset-password)
    exec aldus "$@"
    ;;
esac

mkdir -p "$ALDUS_ALIGNMENT_MODEL_DIR"
cp -an /opt/aldus-models/. "$ALDUS_ALIGNMENT_MODEL_DIR/"
exec aldus "$@"
