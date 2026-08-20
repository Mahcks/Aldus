# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM oven/bun:1.3.5-alpine AS web
WORKDIR /src/app
COPY app/package.json app/bun.lock app/bunfig.toml ./
COPY app/patches ./patches
RUN bun install --frozen-lockfile
COPY app/ ./
RUN bun run build:web

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS server
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/server
COPY server/go.* ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /aldus ./cmd/app

FROM alpine:3.22 AS production
RUN apk add --no-cache ffmpeg && addgroup -S aldus && adduser -S -G aldus aldus && mkdir /data /app && chown aldus:aldus /data /app
WORKDIR /app
COPY --from=server /aldus /usr/local/bin/aldus
COPY --from=web /src/app/dist ./public
USER aldus
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["aldus"]

# Optional single-process image for hosts that run alignment locally. Models are
# fetched at image-build time; jobs run with network fetching disabled.
FROM python:3.11-slim AS alignment
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
    && groupadd --system aldus && useradd --system --gid aldus aldus && mkdir /data /app /models \
    && chown aldus:aldus /data /app /models
COPY tools/requirements-alignment.txt /tmp/requirements-alignment.txt
RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /tmp/requirements-alignment.txt
ENV HF_HOME=/models TORCH_HOME=/models/torch NLTK_DATA=/models/nltk MPLCONFIGDIR=/tmp/matplotlib
RUN python -c "import nltk, whisperx; nltk.download('punkt_tab', download_dir='/models/nltk', raise_on_error=True); whisperx.load_model('base.en', 'cpu', compute_type='int8', vad_method='silero', language='en'); whisperx.load_align_model(language_code='en', device='cpu')"
WORKDIR /app
COPY --from=server /aldus /usr/local/bin/aldus
COPY --from=web /src/app/dist ./public
COPY tools/whisperx_worker.py ./tools/whisperx_worker.py
ENV ALDUS_ALIGNMENT_COMMAND="python3 /app/tools/whisperx_worker.py" \
    ALDUS_ALIGNMENT_MODEL_DIR=/models
USER aldus
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["aldus"]

FROM production AS final
