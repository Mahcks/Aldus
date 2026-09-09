# syntax=docker/dockerfile:1
# WhisperX 3.8.6 requires PyTorch 2.8.x. Upgrade the speech stack together.
# Keep CUDA 12.6 for legacy GPUs; verify Pascal kernels before any upgrade.
# PyTorch 2.14 is the last planned cu126 wheel release, not a required upgrade.
# Existing 2.8 wheels remain usable; do not move legacy builds to CUDA 13.
# https://dev-discuss.pytorch.org/t/3432
# Default to modern NVIDIA GPUs; legacy builds pass CUDA_VERSION=12.6.
ARG CUDA_VERSION=12.8

# Shared web assets.
FROM --platform=$BUILDPLATFORM oven/bun:1.3.5-alpine AS web
ARG EXPO_PUBLIC_WEB_CANONICAL_ORIGIN

ENV EXPO_PUBLIC_WEB_CANONICAL_ORIGIN=$EXPO_PUBLIC_WEB_CANONICAL_ORIGIN

WORKDIR /src/app
COPY app/package.json app/bun.lock app/bunfig.toml ./
COPY app/patches ./patches

RUN bun install --frozen-lockfile

COPY app/ ./

RUN bun run build:web

# Shared server binary.
FROM --platform=$BUILDPLATFORM golang:1.26.6-alpine AS server
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src/server
COPY server/go.* ./

RUN go mod download

COPY server/ ./

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION}" \
    -o /aldus ./cmd/app

# Lightweight server without a bundled alignment worker.
FROM alpine:3.22 AS production

RUN apk add --no-cache curl ffmpeg \
    && addgroup -S aldus \
    && adduser -S -G aldus aldus \
    && mkdir /data /backups /app \
    && printf '#!/bin/sh\necho "alignment unavailable: run an alignment image" >&2\nexit 1\n' > /usr/local/bin/aldus-alignment-unavailable \
    && chmod 755 /usr/local/bin/aldus-alignment-unavailable \
    && chown aldus:aldus /data /backups /app

WORKDIR /app
COPY --from=server /aldus /usr/local/bin/aldus
COPY --from=web /src/app/dist ./public

ENV ALDUS_ALIGNMENT_COMMAND=/usr/local/bin/aldus-alignment-unavailable

USER aldus
EXPOSE 8080
VOLUME ["/data", "/backups"]
ENTRYPOINT ["aldus"]

# Standard image with local CPU alignment. Models are fetched at image-build
# time; jobs run with network fetching disabled.
FROM python:3.11-slim AS alignment
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system aldus \
    && useradd --system --gid aldus aldus \
    && mkdir /data /backups /app /opt/aldus-models /tmp/matplotlib \
    && chown aldus:aldus /data /backups /app /opt/aldus-models /tmp/matplotlib

COPY tools/requirements-alignment.txt /tmp/requirements-alignment.txt
COPY tools/requirements-alignment-overrides.txt /tmp/requirements-alignment-overrides.txt

RUN if [ "$TARGETARCH" = "arm64" ]; then \
        pip install --no-cache-dir \
            torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0; \
    else \
        pip install --no-cache-dir \
            torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 \
            --index-url https://download.pytorch.org/whl/cpu; \
    fi \
    && pip install --no-cache-dir uv==0.12.6 \
    && uv pip install --system --no-cache \
        --override /tmp/requirements-alignment-overrides.txt \
        -r /tmp/requirements-alignment.txt \
    && pip uninstall -y uv

ENV HF_HOME=/opt/aldus-models \
    TORCH_HOME=/opt/aldus-models/torch \
    NLTK_DATA=/opt/aldus-models/nltk \
    MPLCONFIGDIR=/tmp/matplotlib

# Preload the shared models so alignment jobs need no network downloads.
RUN <<'SH'
set -e
python <<'PYTHON'
import nltk
import whisperx

nltk.download(
    "punkt_tab",
    download_dir="/opt/aldus-models/nltk",
    raise_on_error=True,
)
whisperx.load_model(
    "base.en",
    "cpu",
    compute_type="int8",
    vad_method="silero",
    language="en",
)
whisperx.load_align_model(language_code="en", device="cpu")
PYTHON
chown -R aldus:aldus /opt/aldus-models
SH

WORKDIR /app
COPY --from=server /aldus /usr/local/bin/aldus
COPY --from=web /src/app/dist ./public
COPY tools/whisperx_worker.py ./tools/whisperx_worker.py
COPY tools/whisperx_worker_config.py ./tools/whisperx_worker_config.py
COPY tools/whisperx_checkpoints.py ./tools/whisperx_checkpoints.py
COPY tools/whisperx_diagnostics.py ./tools/whisperx_diagnostics.py
COPY --chmod=755 scripts/container-entrypoint.sh /usr/local/bin/aldus-entrypoint

ENV ALDUS_ALIGNMENT_COMMAND="python3 /app/tools/whisperx_worker.py" \
    ALDUS_ALIGNMENT_MODEL_DIR=/data/models

USER aldus
EXPOSE 8080
VOLUME ["/data", "/backups"]
ENTRYPOINT ["aldus-entrypoint"]

# NVIDIA-accelerated variant of the standard alignment-capable image.
FROM pytorch/pytorch:2.8.0-cuda${CUDA_VERSION}-cudnn9-runtime AS alignment-nvidia
ARG CUDA_VERSION

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system aldus \
    && useradd --system --gid aldus aldus \
    && mkdir /data /backups /app /opt/aldus-models /tmp/matplotlib \
    && chown aldus:aldus /data /backups /app /opt/aldus-models /tmp/matplotlib

COPY tools/requirements-alignment.txt /tmp/requirements-alignment.txt
COPY tools/requirements-alignment-overrides.txt /tmp/requirements-alignment-overrides.txt

RUN CUDA_WHEEL=$(echo "$CUDA_VERSION" | tr -d .) \
    && pip install --no-cache-dir \
        torchaudio==2.8.0 torchvision==0.23.0 \
        --index-url "https://download.pytorch.org/whl/cu${CUDA_WHEEL}" \
    && pip install --no-cache-dir uv==0.12.6 \
    && uv pip install --system --no-cache \
        --override /tmp/requirements-alignment-overrides.txt \
        -r /tmp/requirements-alignment.txt \
    && pip uninstall -y uv

COPY --from=alignment --chown=aldus:aldus /opt/aldus-models /opt/aldus-models

WORKDIR /app
COPY --from=server /aldus /usr/local/bin/aldus
COPY --from=web /src/app/dist ./public
COPY tools/whisperx_worker.py ./tools/whisperx_worker.py
COPY tools/whisperx_worker_config.py ./tools/whisperx_worker_config.py
COPY tools/whisperx_checkpoints.py ./tools/whisperx_checkpoints.py
COPY tools/whisperx_diagnostics.py ./tools/whisperx_diagnostics.py
COPY --chmod=755 scripts/container-entrypoint.sh /usr/local/bin/aldus-entrypoint

ENV HF_HOME=/data/models \
    TORCH_HOME=/data/models/torch \
    NLTK_DATA=/data/models/nltk \
    MPLCONFIGDIR=/tmp/matplotlib \
    ALDUS_ALIGNMENT_COMMAND="python3 /app/tools/whisperx_worker.py" \
    ALDUS_ALIGNMENT_MODEL_DIR=/data/models \
    ALDUS_ALIGNMENT_ACCELERATOR=cuda

USER aldus
EXPOSE 8080
VOLUME ["/data", "/backups"]
ENTRYPOINT ["aldus-entrypoint"]

# Named target used by lightweight deployments and the demo.
FROM production AS aldus-base

# Demo-only tooling and startup.
FROM aldus-base AS demo
USER root

RUN apk add --no-cache curl jq su-exec
COPY --chmod=755 demo/fetch.sh /opt/aldus-demo/fetch
COPY demo/catalog.json /opt/aldus-demo/catalog.json
COPY --chmod=755 demo/fly-entrypoint.sh /usr/local/bin/fly-entrypoint
ENTRYPOINT ["fly-entrypoint"]
CMD ["aldus"]

# A plain docker build produces the CPU alignment image.
FROM alignment AS final
