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

Run both development servers with `make dev`, or separately with `make dev-server` and `make dev-app`. The standard web workflow allows Expo's `http://localhost:8081` origin automatically and uses `aldus-dev-bootstrap` as the local first-admin bootstrap token. Development defaults to `http://localhost:8080`; override `EXPO_PUBLIC_API_URL` and `ALDUS_ALLOWED_ORIGINS` together when using another web origin. Physical devices need your computer's LAN address, while Android emulators commonly use `http://10.0.2.2:8080`. Production web builds use the same-origin `/api` path.

The server accepts `ALDUS_ADDR` (default `:8080`), `ALDUS_DATA_DIR` (default `/data`), `ALDUS_MEDIA_DIR` (default `$ALDUS_DATA_DIR/media`), `ALDUS_SOURCE_ROOTS` (comma-separated server-visible media roots), `ALDUS_MAX_UPLOAD_BYTES` (default 2 GiB), `ALDUS_KOREADER_USER` (default `aldus`), and `ALDUS_KOREADER_KEY` (default `aldus`). Set a unique `ALDUS_BOOTSTRAP_TOKEN` before creating the first administrator; setup is disabled when it is empty and permanently closes after the first user. Set `ALDUS_SECURE_COOKIES=true` when serving over HTTPS. For a web client on another origin, set `ALDUS_ALLOWED_ORIGINS` to a comma-separated exact-origin allowlist such as `http://localhost:8081`; credentialed CORS is disabled when it is empty. Audiobook ingestion requires `ffprobe`; it is included in the production image. KOReader sends its stored key exactly as `x-auth-key`; use the value KOReader generates for the configured password in a real deployment.

## Test Aldus on a real iPhone

Aldus uses an installed Expo development client, not Expo Go or EAS Build, for normal physical-device development. The generated `app/ios/` project is local CNG output and is intentionally ignored by Git.

### Mac and iPhone prerequisites

1. Install the current Xcode from the App Store, open it once, accept its license, and install the requested platform components.
2. Select Xcode's command-line tools in Xcode Settings, or run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
3. Install Node.js LTS and Bun 1.3.5. Run `cd app && bun install` after cloning or pulling dependency changes.
4. CocoaPods is required by the generated iOS project. Expo normally runs it during prebuild; if `pod` is missing, install CocoaPods on the Mac before retrying. Watchman is optional and is not required by Aldus.
5. Connect the unlocked iPhone to the Mac by cable, tap **Trust** on both devices, and leave the phone visible in Xcode's Devices and Simulators window.
6. On iOS 16 or newer, open **Settings → Privacy & Security → Developer Mode**, enable it, restart when prompted, and confirm after restart.

### Reach the backend over the LAN

`localhost` on the iPhone means the iPhone itself. Set the public Expo variable to an address that the phone can reach. Do not commit a personal IP address.

```sh
export EXPO_PUBLIC_API_URL=http://aldus-dev.local:8080
# Or: export EXPO_PUBLIC_API_URL=http://192.168.x.x:8080
```

The phone, Mac running Metro, and backend machine normally need to be on the same network. The development server command already uses `ALDUS_ADDR=:8080`, which listens on LAN interfaces. Permit inbound TCP 8080 in the backend machine's firewall. Native requests are not governed by browser CORS; keep `ALDUS_ALLOWED_ORIGINS` limited to the actual web-development origins.

Before opening the app, verify the backend from Safari on the iPhone:

```text
http://aldus-dev.local:8080/healthcheck
```

### Fresh checkout and first local development build

Clone or open the checkout on the Mac mini, install dependencies, and start the backend on the backend machine:

```sh
git clone https://github.com/mahcks/aldus.git
cd aldus
cd app
bun install
cd ..

# Run this on the backend machine if it is the same checkout.
make dev-server
```

Confirm `http://aldus-dev.local:8080/healthcheck` opens in iPhone Safari. Then, from the Mac checkout:

```sh
EXPO_PUBLIC_API_URL=http://aldus-dev.local:8080 make ios-dev
```

`make ios-dev` runs `expo run:ios --device`. Expo generates `app/ios/` when necessary, asks for the connected device, compiles with the local Xcode toolchain, installs the development client, and starts Metro. It does not use EAS.

If automatic signing needs attention, add your Apple Account under **Xcode → Settings → Accounts**, then open `app/ios/Aldus.xcworkspace`. Select the Aldus target, open **Signing & Capabilities**, enable **Automatically manage signing**, choose your Personal Team, select the connected iPhone as the run destination, and press Run. Do not commit a personal Team ID or signing certificate. A free Personal Team supports Aldus's current local-network, SecureStore, and background-audio development requirements. Its profiles are short-lived and it does not support capabilities such as production push notifications or App Store distribution, neither of which Aldus currently requires for this checklist. App Store and TestFlight setup are not required.

If iOS asks you to trust the development certificate, open **Settings → General → VPN & Device Management**, select the developer entry, and trust it.

### Daily development after installation

For TS, TSX, CSS, and ordinary application logic changes, start only Metro on the Mac that contains the checkout and dependencies:

```sh
EXPO_PUBLIC_API_URL=http://aldus-dev.local:8080 make expo-dev
```

Open Aldus on the iPhone and select the detected development server, or scan Metro's development-client QR code. If discovery fails, use the development client's **Enter URL** action and paste the development-server URL printed by Metro. Metro uses LAN mode. If editing primarily on another computer, the simplest workflow is a synced or Git checkout on the Mac mini and running Metro there; alternatively Metro may run on the editing machine if the iPhone can reach its advertised LAN address.

Rebuild with `make ios-dev` after adding or removing a native dependency, changing `app.json` native configuration or plugins, changing entitlements/capabilities, or upgrading Expo/React Native. A rebuild is normally unnecessary after TS/TSX, styling, API-client, copy, or most application-logic changes.

`make web-dev` retains the existing web-only Metro workflow. The tagged GitHub release workflow only builds and publishes the combined Go/web Docker image; it is not a native build or Expo update script and remains separate from local iPhone development. No EAS configuration or update/publish script is currently present.

### Common failures

- **Phone cannot reach Aldus:** confirm `EXPO_PUBLIC_API_URL` is not `localhost`, open `/healthcheck` in iPhone Safari, verify both devices are on the same LAN, and allow port 8080 through the backend firewall.
- **Development client cannot find Metro:** run `make expo-dev` on the Mac checkout, keep the phone and Mac on the same LAN, disable VPN/client isolation temporarily, and allow Node/Metro through the Mac firewall.
- **Signing fails:** trust the phone, select the correct Team with automatic signing in Xcode, and ensure `com.mahcks.aldus` is available to that Team.
- **Personal Team is unavailable:** add your Apple Account under Xcode Settings → Accounts, reopen Signing & Capabilities, and select the Personal Team associated with that account.
- **Developer Mode is disabled:** enable it under Privacy & Security, restart, and reconfirm.
- **Device is not trusted:** reconnect the unlocked phone, accept the trust prompts on both devices, and verify it appears in Xcode's Devices and Simulators window.
- **Native changes are missing:** rebuild with `make ios-dev`; restarting Metro cannot update native modules or entitlements.
- **HTTP development endpoint fails:** use a LAN or `.local` endpoint and rebuild after changing native local-network configuration. Use HTTPS outside a trusted development LAN.

### Physical iPhone acceptance checklist

- **Authentication:** setup/login, relaunch and session restore, logout.
- **Consumer:** Home, Search, Library, Work, long-title layout, navigation and safe areas.
- **Reader:** open EPUB, previous/next page, reading cursor, Listen from Here, lock/unlock, background/foreground.
- **Audio:** play/pause, ±15 seconds, seek, 1×/1.5×/2× with preserved pitch, Bluetooth/AirPods when available, screen-lock and background playback, lock-screen metadata.
- **Synchronization:** Read → Listen, Listen → Read, non-anchor positions, partial and unavailable synchronization.
- **Persistence:** force quit, reopen, verify session and exact progress restoration.
- **Native UX:** keyboard/forms, touch targets, text scaling, portrait orientation, and the current automatic system appearance behavior.

### Media folders

Local Sources are folders visible to the Aldus server. Mount externally owned media read-only, then allowlist the container path. The included Compose file uses:

```yaml
volumes:
  - /host/books:/library/media:ro
environment:
  ALDUS_SOURCE_ROOTS: /library/media
```

Set `ALDUS_SOURCE_PATH=/host/books` before `docker compose up` to use that pattern with the included Compose file. Aldus administrators can then choose `/library/media` or one of its subfolders from Sources & Imports. Aldus never browses outside configured roots, and source roots cannot overlap `/data` or managed media storage.

On Windows or WSL, distinguish the host path from the server-visible path. A Windows folder such as `D:\Media\Books` may be mounted into the container as `/library/media`; Aldus selects `/library/media`, not the Windows path. Ensure the container user can read the mounted directory.

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
