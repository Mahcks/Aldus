# Contributing to Aldus

Thanks for helping improve Aldus. It is public beta software, so focused bug fixes, documentation corrections, accessibility improvements, and reports from real self-hosted libraries are especially useful.

Keep changes small, preserve existing user data and installed-client behavior, and avoid adding dependencies or abstractions without a current requirement.

## Development setup

You need Go 1.26.6+, Bun 1.3.5+, Node.js LTS, `ffprobe`, and Docker for production-image work.

```sh
cd app && bun install && cd ..
make dev
```

| Command | Does |
| --- | --- |
| `make dev-server` | Run the Go server on port 8080 |
| `make dev-app` | Run the Expo development server |
| `make expo-dev` | Run Metro for an installed native development client |
| `make ios-dev` | Build and install the iOS development client |
| `make dev-docs` | Run the Starlight documentation site |
| `make demo-media` | Fetch and verify the public-domain demo catalog |
| `make generate` | Regenerate sqlc and public TypeScript contracts |
| `make lint` | Run Go vet, formatting checks, and Expo lint |
| `make test` | Run Go, race, client, and TypeScript tests |
| `make build` | Build the production web app and Go server |
| `make docker` | Build the production container locally |

The repository has four main parts:

- `server/` — Go API, SQLite migrations, media processing, and the production web server.
- `app/` — universal Expo web, iOS, and Android client.
- `tools/` — the external WhisperX alignment worker.
- `docs/` — the Astro Starlight site plus repository-only technical references.

The production image contains the Go server and exported Expo web app together. Do not introduce a second production service or image for ordinary application code.

## Contracts and generated code

Public JSON contracts live in `server/internal/api/contracts` and generate `app/src/generated/api.ts`. Stable SQL queries generate into `server/internal/database/sqlc`. Never edit either generated directory by hand; change its source and run:

```sh
make generate
```

See [docs/code-generation.md](docs/code-generation.md) for the boundaries between generated and handwritten code. Synchronization changes must also follow [docs/sync-architecture.md](docs/sync-architecture.md) and preserve the exact-progress acceptance fixtures.

API v1 is additions-only while a released client depends on it:

- Adding an endpoint or response field is compatible; the server may ship first.
- A new optional client feature must work when an older server does not provide it.
- Removing or renaming a field or route, changing its type or meaning, or changing authentication/status behavior requires a future `/api/v2` while v1 remains available.
- Current clients call `/api/v1`. `/api` remains a permanent v1 alias for already-installed clients.

## Validate a change

Run the checks that cover your change. Before submitting a broad server or client change, run:

```sh
make generate
make lint
make test
make build
git diff --check
```

Documentation changes should also pass:

```sh
cd docs && bun run build
```

Do not include generated build output, local databases, media, credentials, or release artifacts.

## Maintainer releases

The API and exported web client ship together in one container. A normal beta publishes that container and moves the public demo to the same source tag:

```sh
make release VERSION=0.1.0-beta.17
```

The command requires a clean `main` matching `origin/main` with successful CI. It waits for the GHCR workflow, backs up the demo, deploys the tagged source to Fly, and checks readiness. Redeploy or roll back only the demo with `make demo-deploy VERSION=0.1.0-beta.17`.

iOS releases independently because installed clients and self-hosted servers update on different schedules:

```sh
make ios-testflight
make ios-external BUILD_ID=<processed-build-id>
make ios-release VERSION=0.1.0 BUILD_ID=<tested-build-id>
```

`ios-testflight` records the exact commit and pinned server release in the artifact folder and TestFlight notes. `ios-external` promotes that binary to external review. `ios-release` attaches the tested build to its App Store version and validates it; final App Store submission remains a manual App Store Connect action.

Use `make release-all VERSION=0.1.0-beta.17` only when one commit genuinely needs the container, demo, and iOS candidate. Use the narrower command for server-only or iOS-only changes. A new iOS upload does not replace installed builds, so every non-expired TestFlight build still assigned to a group must remain compatible with a server candidate.
