# Aldus

Aldus is a self-hosted books and audiobooks platform. This repository contains a universal Expo client and a Go HTTP server; the production image serves both the API and exported web client.

## Layout

- `app/` — Expo Router app for iOS, Android, and web
- `server/` — Go API and production web server
- `.github/workflows/` — CI and tagged GHCR releases

## Prerequisites

Go 1.25+, Bun 1.3.5+, Node.js LTS for Expo's native tooling, and optionally Docker.

Install client dependencies once with `cd app && bun install`.

## Development

Run both development servers with `make dev`, or separately with `make dev-server` and `make dev-app`. Development defaults to `http://localhost:8080`; override `EXPO_PUBLIC_API_URL` for physical devices or Android emulators. Physical devices need your computer's LAN address, while Android emulators commonly use `http://10.0.2.2:8080`. Production web builds use the same-origin `/api` path.

The server accepts `ALDUS_ADDR` (default `:8080`), `ALDUS_DATA_DIR` (default `/data`), `ALDUS_MEDIA_DIR` (default `$ALDUS_DATA_DIR/media`), `ALDUS_MAX_UPLOAD_BYTES` (default 2 GiB), `ALDUS_KOREADER_USER` (default `aldus`), and `ALDUS_KOREADER_KEY` (default `aldus`). Set a unique `ALDUS_BOOTSTRAP_TOKEN` before creating the first administrator; setup is disabled when it is empty and permanently closes after the first user. Set `ALDUS_SECURE_COOKIES=true` when serving over HTTPS. For a web client on another origin, set `ALDUS_ALLOWED_ORIGINS` to a comma-separated exact-origin allowlist such as `http://localhost:8081`; credentialed CORS is disabled when it is empty. Audiobook ingestion requires `ffprobe`; it is included in the production image. KOReader sends its stored key exactly as `x-auth-key`; use the value KOReader generates for the configured password in a real deployment.

Alignment jobs use one local external process at a time. `ALDUS_ALIGNMENT_COMMAND` defaults to `python3 ../tools/whisperx_worker.py`, `ALDUS_ALIGNMENT_TIMEOUT_SECONDS` defaults to 7200, and `ALDUS_ALIGNMENT_MODEL_DIR` selects the pre-populated Hugging Face cache. Jobs force offline model loading, so missing models fail closed instead of downloading mutable assets. For a local environment, install [`tools/requirements-alignment.txt`](tools/requirements-alignment.txt) and pre-cache `base.en`, Silero VAD, and WhisperX's English alignment model. The optional `make docker-alignment` image performs that download at image-build time; the normal image remains Go/Expo-only. The Alice CPU baseline was about 165 seconds and 2.7 GiB RAM.

The deterministic unit-test alignment is `fixture-alignment`. Fetch the frozen real Alice media with `make fixture`; see [`docs/test-fixtures.md`](docs/test-fixtures.md). The real Alice fixtures validate exact DOM-range restoration, manual seeking, and the adopted WhisperX 3.8.6 MVP candidate against separately human-authored audible-onset anchors.

## Build and test

```sh
make build
make test
make lint
```

`make docker` builds `ghcr.io/mahcks/aldus`. Run it with `docker compose up --build`, then open <http://localhost:8080>; SQLite data is kept in the `aldus-data` Docker volume.

Run `make generate` after changing named SQL queries or public Go API contracts. See [docs/code-generation.md](docs/code-generation.md) for the pinned sqlc and Tygo workflow.

## Exact-progress fixture

The initial screen is a deterministic sentence-alignment proof, not a library UI. Select a sentence in Read mode, switch to Listen, and Aldus resolves the canonical segment to its exact fixture timestamp. Selecting an audio cue performs the reverse translation. Both `/api/*` and explicit `/api/v1/*` routes address v1.

Run the stale-client and all locator round-trip proofs with:

```sh
cd server
go test ./internal/position ./internal/api/v1 ./internal/api/koreader
```

Configure KOReader's custom progress server to the Aldus origin and log in with `ALDUS_KOREADER_USER` and `ALDUS_KOREADER_KEY`. `ALDUS_KOREADER_USER` must match an enabled Aldus username with access to the book's library. The bundled synthetic document alias is only for automated tests; a real KOReader test requires importing and aligning the exact sideloaded EPUB revision.
