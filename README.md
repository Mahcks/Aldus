<div align="center">

<h1>
  <img src="docs/public/images/icon.png" alt="Aldus icon" width="40" height="40" align="absmiddle">
  Aldus
</h1>

**A self-hosted home for the books you own — ebooks and audiobooks, read together.**

[![Status: beta](https://img.shields.io/badge/status-beta-8a3c24)](#current-beta-status)
[![License: MIT](https://img.shields.io/badge/license-MIT-8a3c24)](LICENSE)

[TestFlight beta](https://testflight.apple.com/join/FUfZvzkt) · [Live demo](https://demo.aldus.media) · [Quickstart](#run-the-server) · [Screenshots](#what-it-looks-like)

</div>

<br>

Most people who own both an ebook and its audiobook edition live with two disconnected apps and no memory between them: close the book on your commute, lose your place when you pick up the audio that night. Aldus is a personal library server that finds your books, brings in the format you're missing, and keeps your exact position synchronized between reading and listening — down to the sentence, not just "roughly where you were."

It's built for the way a household actually keeps books. One person hosts it. Everyone else opens a title and reads or listens, without ever needing to know what a library, a source, or an indexer is. The person running it gets real controls — storage, download policy, permissions, backups. Everyone else gets a calm, book-shaped app that gets out of the way.

<br>

## Current beta status

Aldus is public beta software. The source, self-hosted server, web app, and public demo are available now; anyone with an iPhone or iPad can [join the public TestFlight beta](https://testflight.apple.com/join/FUfZvzkt). Android is implemented but does not yet have a public build. Expect rough edges and take a verified backup before upgrading a server you depend on.

<br>

## Run the server

Every tagged release publishes a ready-to-run, multi-architecture image to GitHub Container Registry. **There is nothing to build.** `docker compose up -d` pulls `ghcr.io/mahcks/aldus` and starts serving — no Go toolchain, no Node, no local Dockerfile.

```sh
ALDUS_VERSION=0.1.0-beta.16
mkdir -p aldus/library-media aldus/downloads && cd aldus
curl -fL "https://github.com/Mahcks/Aldus/releases/download/v${ALDUS_VERSION}/compose.yml" -o compose.yml
printf 'ALDUS_VERSION=%s\n' "$ALDUS_VERSION" > .env
docker compose up -d --pull always
docker compose ps
```

Compose does not build Aldus or require the repository. It pulls the exact `ghcr.io/mahcks/aldus:0.1.0-beta.16` image and adds the restart policy, persistent volumes, health check, and safe localhost port mapping that a long `docker run` command would need. When `docker compose ps` reports **healthy**, open [http://localhost:8080](http://localhost:8080) and create the first account — it becomes the administrator. Do that before exposing Aldus to another machine.

> **Current beta note:** `0.1.0-beta.16` includes CPU alignment and publishes an optional NVIDIA CUDA image. Image downloads are large, so first startup time depends on your connection and host.

Prefer to look before downloading anything? [demo.aldus.media](https://demo.aldus.media) runs the current build against a small public-domain catalog — no account required.

<br>

## What it looks like

<table>
<tr>
<td width="50%">
<img src="docs/public/images/reader-epub.png" alt="Aldus ebook reader showing a synchronized passage and a Listen from here action">
<p align="center"><sub>Read with adjustable typography, layout, and an exact synchronized passage</sub></p>
</td>
<td width="50%">
<img src="docs/public/images/reader-audio.png" alt="Aldus audiobook player showing chapters, playback controls, and a synchronized read-along passage">
<p align="center"><sub>Listen with chapters, saved progress, and a live read-along passage</sub></p>
</td>
</tr>
</table>

<br>

## Read↔listen sync that means it

When a book's ebook and audiobook are aligned, switching from reading to listening resumes at the *same point in the text* — not an approximate percentage rounded to the nearest chapter. The standard image runs WhisperX on CPU automatically in the background; an optional NVIDIA image accelerates the same work.

```mermaid
flowchart LR
    A[Reading on your phone] -->|close the book at 27%| B[(Aligned position store)]
    B -->|resume at the same sentence| C[Listening on the way home]
    C -->|pause the audio| B
    B -->|pick the book back up| A
```

<br>

## Ask for what's missing, without the busywork

Point Aldus at your indexers and download client once, and an ordinary reader never has to think about either again.

```mermaid
flowchart LR
    U([Household member<br/>requests a format]) --> R{Aldus checks<br/>the owner's rules}
    R -->|within policy| P[Prowlarr searches<br/>configured indexers]
    P --> Q[qBittorrent<br/>downloads the release]
    Q --> V[Aldus verifies size,<br/>checksum, and format]
    V --> L[(Imported and<br/>ready to open)]
    R -->|needs approval| O[Library owner<br/>approves or declines]
    O --> P
```

Indexer names, file sizes, and release strings never surface to someone who just wants to read. They see plain-language status in **Activity**: searching, downloading, importing, ready. If nothing suitable exists yet, the request stays open and Aldus keeps watching — it never dead-ends silently.

<br>

## Everything else Aldus does

| | |
| --- | --- |
| **A household, not just a user** | Libraries are access grants, not walls. Most setups need zero configuration; multi-library households — a shared collection plus a kids' library — get real isolation when they need it. |
| **Bring what you already have** | Point Aldus at a folder of EPUBs and audio files and it imports them without renaming or rewriting a single file. Nothing you already own gets touched. |
| **Two ways to store media** | External Sources stay exactly where they are, referenced read-only. Managed media from acquisitions is copied in, checksummed, and verified on import. |
| **Read anywhere** | The web app ships with every server. The iOS app is available through the [public TestFlight beta](https://testflight.apple.com/join/FUfZvzkt). Android is implemented but does not yet have a public beta distribution channel. OPDS + KOReader credentials support e-ink devices. |
| **Verified backups** | `docker compose run --rm aldus backup` produces a checksummed archive of the database, managed media, covers, and alignment artifacts. The stored Prowlarr API key, qBittorrent password, and active sessions are removed from the archive. |
| **It's yours** | Self-hosted, your data, on your hardware. No account required anywhere but your own server. |

<br>

## Choose how far you want to go

| I want to… | Set up… | Then explore… |
| --- | --- | --- |
| Browse books I already own | One Library and one Source | Home, Discover, and Collections |
| Read an EPUB | An imported EPUB | The title page, then **Read** |
| Listen to an audiobook | Imported MP3/M4B audio | The title page, then **Listen** |
| Test read/listen synchronization | Matching ebook and audiobook | Switching formats without losing your place |
| Request missing formats | Prowlarr, qBittorrent, and library download rules | Discover and Activity |
| Use KOReader | A reader credential | Account → KOReader and OPDS |

Drop a few EPUB, MP3, M4B, or audiobook files into `library-media/`, then: open **More → Libraries** and create one, open **More → Sources** and add `/library/media`, start a scan, accept anything in **Import review**, and open a title from **Home** or **Discover**. You do not need Prowlarr or qBittorrent just to try the library and reader.

The Compose file mounts `./library-media` read-only. Aldus indexes those files but never renames, moves, or rewrites them.

<br>

## Set up automatic requests

This part is optional. Aldus currently works with [Prowlarr](https://prowlarr.com/) to search your configured indexers and [qBittorrent](https://www.qbittorrent.org/) to download a selected release. Usenet clients aren't supported yet.

Open **More → Acquisitions**, connect both services, and test each connection. Then, per library, set default destinations, maximum size, allowed formats, preferred language, and whether abridged audiobooks are acceptable. Finally choose what each member may do: request a missing format, skip approval for compliant requests, or use advanced release choice instead of Aldus's guided pick.

For acquisitions, qBittorrent and Aldus must see the same completed-download folder. Set `ALDUS_DOWNLOAD_PATH` to the host folder qBittorrent uses, then set **qBittorrent download root** in Aldus to qBittorrent's container path (commonly `/downloads`).

<br>

## Backups and upgrades

Create and download a verified backup from **More → System → Data and recovery**. The command line remains available for emergency recovery:

```sh
docker compose run --rm aldus backup \
  --archive /backups/aldus-backup-$(date +%Y%m%d).tar.gz
```

Restore while Aldus is stopped and `/data` is empty:

```sh
docker compose stop aldus
docker compose run --rm aldus restore \
  --archive /backups/aldus-backup-20260819.tar.gz \
  --data-dir /data
docker compose up -d
```

To update, take a backup, download the new release's `compose.yml`, change `ALDUS_VERSION` in `.env`, then run `docker compose pull && docker compose up -d`. This keeps the image and its deployment configuration on the same release. To roll back, restore the matching backup and use both the previous image version and previous Compose file. Aldus intentionally has no implicit `latest` fallback.

<br>

## Using Aldus away from your server

The default Compose mapping is localhost-only. Before making it reachable elsewhere, create the first administrator and put Aldus behind an HTTPS reverse proxy. Set `ALDUS_BIND_HOST=0.0.0.0` and `ALDUS_SECURE_COOKIES=true` when the proxy reaches Aldus over the host network. Trusted-LAN-only HTTP remains available for native clients on private IPs, but requires the explicit `ALDUS_ALLOW_INSECURE_HTTP=true` acknowledgement. Never expose that mode to the internet.

## Optional NVIDIA acceleration

The standard Aldus image includes WhisperX and generates exact read/listen mappings on CPU without extra setup. CPU processing can take hours for a long audiobook. To accelerate it, install the NVIDIA driver and [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html), then run one command:

```sh
curl -fL https://github.com/Mahcks/Aldus/releases/download/v0.1.0-beta.16/compose.gpu.yml -o compose.gpu.yml
docker compose -f compose.yml -f compose.gpu.yml up -d --pull always
```

The override replaces the same `aldus` container and requests one GPU. Aldus selects CUDA, FP16, and a conservative memory profile internally. If CUDA is unavailable, the alignment job reports a useful error while the rest of Aldus remains available. Return to CPU processing with `docker compose up -d --pull always`.

For e-ink devices, create a credential under **Account → KOReader and OPDS**, then add the displayed `/opds/` URL as an OPDS catalog and use the Aldus origin as KOReader's custom progress server.

<br>

## When something doesn't work

**Aldus can't see my books** — confirm the host folder is mounted, that the Source path is `/library/media` (not the host's original path), and that `ALDUS_SOURCE_ROOTS` includes the server-visible path.

**A request doesn't start** — test Prowlarr and qBittorrent under **More → Acquisitions**, confirm the library has default destinations for that format, and check whether the request is waiting on approval.

**A download finished but the title is unavailable** — confirm `ALDUS_DOWNLOAD_PATH` matches qBittorrent's folder, confirm **qBittorrent download root** is set correctly, and check **More → Sources → Import review** — Aldus asks for help when a completed payload is ambiguous or conflicts with an existing format.

**Is the server healthy?** `/api/health` confirms the process is running; `/api/ready` checks SQLite and data-directory write access.

<br>

## Maintainer releases

The API and exported web client ship together in one container. A normal beta publishes that container and moves the public demo to the exact same source tag:

```sh
make release VERSION=0.1.0-beta.16
```

The command requires a clean `main` matching `origin/main` with successful CI, waits for the GHCR workflow, backs up the demo, deploys the tagged source to Fly, and checks its readiness endpoint. Redeploy or roll back only the demo with `make demo-deploy VERSION=0.1.0-beta.16`.

iOS moves independently. On the Mac mini, authenticate once with `asc auth login` and `eas login`; the script finds Aldus's App Store record from its bundle identifier. The ignored `scripts/ios-release.env` is only needed for custom group names or optional remote-Mac settings.

```sh
make ios-testflight
make ios-external BUILD_ID=<processed-build-id>
make ios-release VERSION=0.1.0 BUILD_ID=<tested-build-id>
```

`ios-testflight` requires the exact current `origin/main` commit, records that commit and the pinned server release in the artifact folder and TestFlight notes, compiles locally, uploads with `asc`, waits for processing, and adds the build to the internal group. `ios-external` promotes that same binary to external TestFlight review. `ios-release` attaches the tested build to its App Store version and validates it; the final review submission remains an intentional App Store Connect action. From another trusted computer, configure the optional Mac host/path and run `make ios-testflight-remote REF=<commit-or-tag>`.

When one commit genuinely needs every surface, `make release-all VERSION=0.1.0-beta.16` performs the container/demo release and then starts the local or remote iOS candidate. Server-only and iOS-only fixes should use their narrower commands instead.

<br>

## Developing Aldus

You need Go 1.26+, Bun 1.3.5+, Node.js LTS, `ffprobe`, and Docker for production-image work.

```sh
cd app && bun install && cd ..
make dev
```

| Command | Does |
| --- | --- |
| `make dev-server` | Go server on port 8080 |
| `make dev-app` | Expo development server |
| `make expo-dev` | Metro for an installed native development client |
| `make ios-dev` | Build and install the iOS development client |
| `make demo-media` | Fetch and verify the public-domain demo catalog |
| `make build` | Production web export and Go build |
| `make test` | Go, race, client, and TypeScript tests |
| `make lint` | Go vet, formatting, and Expo lint |
| `make generate` | Regenerate sqlc and public TypeScript contracts |
| `make docker` | Build the production container locally |

The repository stays small on purpose: `app/` is the universal Expo client, `server/` is the Go API and production web server, `tools/` is the alignment worker, and `docs/` is the Astro Starlight documentation site. The production image serves both the API and the exported web app from one binary.

<br>

## Where this is headed

The ambition is a complete, calm home for the books you own — one that treats reading and listening as one continuous act instead of two apps that happen to share a title. Acquisition, alignment, and the household permission model are the parts still hardening the fastest, so expect them to change shape a little before things settle. Aldus is in beta and ready for focused real-world testing, but it is not yet a stable 1.0 release. If something doesn't add up, that report is exactly what's useful right now.

<p align="center">
  <img src="docs/public/images/demo.png" alt="Aldus public demo landing page" width="850">
</p>
