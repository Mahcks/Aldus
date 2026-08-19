# Aldus

Aldus is a self-hosted home for ebooks and audiobooks. Search your entire catalog, request a missing format, and read or listen from the same app on web, iPhone, and Android.

When both an ebook and audiobook are available, Aldus can synchronize them so you can move between reading and listening without losing your place.

## What Aldus does

- Keeps ebooks and audiobooks together by title.
- Reads EPUBs and plays audiobooks in the app.
- Synchronizes exact reading and listening positions across devices.
- Searches your local catalog and Open Library from one screen.
- Requests ebooks and audiobooks independently.
- Watches for unavailable releases and tells you when they are ready.
- Applies owner-defined download rules and approval requirements.
- Organizes books into personal collections.
- Imports existing folders without rewriting the original files.
- Stores new acquisitions in optional Aldus-managed storage.
- Provides OPDS and KOReader credentials per user.
- Creates verified backups of its database and managed files.

Readers use **Home**, **Search**, **Collections**, and **Activity**. Libraries, folders, download connections, approvals, and import review stay under **Administration**.

## Quick start with Docker

You need Docker with Compose support.

```sh
git clone https://github.com/mahcks/aldus.git
cd aldus
cp .env.example .env
docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080) and create the first administrator account.

The included Compose setup stores Aldus data in a Docker volume and mounts `./library-media` as a read-only folder for books you already own. You can change both host folders in `.env`:

```dotenv
ALDUS_SOURCE_PATH=/path/to/your/books
ALDUS_BACKUP_PATH=/path/to/your/backups
```

Use an absolute path when possible. On Windows, this can be a path such as `D:\Media\Books`; Docker exposes it to Aldus as `/library/media`.

### HTTPS

The example uses plain HTTP for a trusted home network. If you put Aldus behind an HTTPS reverse proxy, set:

```dotenv
ALDUS_SECURE_COOKIES=true
```

Complete the first-account setup before exposing Aldus outside your trusted network.

## First-time setup

After creating the administrator:

1. Create a Library under **Administration → Libraries**.
2. Add an existing media folder as a Source, or use the built-in **Aldus managed downloads** Source.
3. Scan the Source and review any uncertain matches.
4. Optionally connect Prowlarr and qBittorrent under **Administration → Acquisitions**.
5. Set the Library's ebook and audiobook rules and choose who may request them.
6. Invite household members and assign their permissions.

Once setup is complete, readers do not need to choose Libraries, Sources, folders, or download destinations. They search for a title and choose **Read**, **Listen**, or **Request**.

## Adding books you already own

Aldus calls a server-visible media folder a **Source**. The included Docker setup mounts your host folder at `/library/media` without write access.

In Aldus:

1. Open **Administration → Libraries**.
2. Select a Library and add `/library/media` as a Source.
3. Start a scan.
4. Review only the items Aldus could not match confidently.

Aldus does not rename, move, or modify files in an externally managed Source. Those files remain your responsibility to back up.

## Requests and automatic downloads

Aldus can connect to:

- [Prowlarr](https://prowlarr.com/) for searching configured indexers.
- [qBittorrent](https://www.qbittorrent.org/) for downloading selected releases.

Configure both from **Administration → Acquisitions**. Then configure each Library's rules:

- Default ebook and audiobook destination.
- Maximum size for each format.
- Allowed file formats.
- Preferred language.
- Whether abridged audiobooks are allowed.
- Maximum active requests per user.

Member permissions are separate:

- **Can request:** may request missing ebooks or audiobooks.
- **Skip approval:** compliant requests may begin automatically.
- **Advanced release choice:** may inspect and choose raw releases instead of using guided selection.

For normal readers, Aldus applies the rules automatically and hides release names, indexers, sizes, and download folders. If no suitable release exists, Aldus keeps watching and reports progress in **Activity**.

Usenet clients are not supported yet. Aldus currently sends acquisitions only to qBittorrent.

## Managed and external media

Aldus supports two storage styles:

- **Managed media:** acquisitions are copied into Aldus's data directory under generated safe names. Aldus verifies the copied size and SHA-256 checksum before importing it. The original qBittorrent payload is not deleted.
- **External media:** Aldus references files in your mounted Source and never rewrites them.

Managed media is included in Aldus backups. External media is not; the backup manifest and System diagnostics report how many external files still require a separate backup.

## Backups

Create a verified online backup:

```sh
docker compose run --rm aldus backup \
  --archive /backups/aldus-backup-$(date +%Y%m%d).tar.gz
```

The archive includes:

- The Aldus database.
- Aldus-managed acquisition media.
- Uploaded and generated covers.
- Alignment artifacts.
- A manifest with SHA-256 checksums.

Prowlarr API keys and qBittorrent passwords are removed from the backup copy. Enter them again after restoring.

Externally mounted Source files are not included. Back them up separately.

### Restore

Restore while Aldus is stopped. The destination data directory must be empty.

```sh
docker compose stop aldus
docker compose run --rm aldus restore \
  --archive /backups/aldus-backup-20260817.tar.gz \
  --data-dir /data
docker compose up -d
```

Aldus validates every checksum before publishing restored files. Restore with the same Aldus version that created the backup, verify the installation, and then upgrade.

## KOReader and OPDS

Create a reader credential under **Account → KOReader and OPDS**.

- Add the displayed `/opds/` URL to KOReader as an OPDS catalog.
- Use the Aldus origin as KOReader's custom progress server.
- Enter the generated username and password for both.

Each credential belongs to one Aldus user and can be revoked independently. Use HTTPS when credentials cross an untrusted network.

## Updating Aldus

Pin `ALDUS_VERSION` in `.env` to the release you want to run, then pull and restart:

```sh
docker compose pull
docker compose up -d
```

Create a backup before upgrading. Avoid relying on `latest` for an installation you care about.

## Troubleshooting

### Aldus cannot see my books

- Confirm the host folder is mounted into the container.
- Select the container path `/library/media`, not the original Windows, macOS, or Linux path.
- Confirm Docker can read the host folder.
- Check that `ALDUS_SOURCE_ROOTS` contains the server-visible path.

### A request never starts

- Test the Prowlarr and qBittorrent connections in Administration.
- Confirm the Library has default ebook and audiobook destinations.
- Check whether the request is waiting for owner approval.
- Review the configured size, format, language, and abridged rules.
- Open Activity for the reader-facing explanation and Acquisitions for administrator details.

### A download is complete but the book is unavailable

Open **Administration → Sources** and check Import Review. Aldus sends ambiguous editions, multiple-book downloads, and conflicting same-format media to review instead of guessing.

### Health checks

- `/api/health` confirms that the process is running.
- `/api/ready` also checks SQLite and write access to the data directory.
- `/healthcheck` remains available for compatible reader clients and simple LAN testing.

## Mobile apps

Aldus is an Expo app for iOS, Android, and web. This repository currently documents local development builds; App Store, Play Store, TestFlight, and EAS distribution are not configured.

For day-to-day TypeScript and styling work on an installed development client:

```sh
export EXPO_PUBLIC_API_URL=http://192.168.x.x:8080
make expo-dev
```

The phone, Metro machine, and Aldus server must be reachable on the same network. Verify the backend in the phone's browser before debugging the app:

```text
http://192.168.x.x:8080/healthcheck
```

On a Mac with Xcode and a connected iPhone, build and install the native development client with:

```sh
cd app
bun install
cd ..
make ios-dev
```

Rebuild the native client after changing native dependencies, Expo plugins, entitlements, or native configuration. Ordinary TS, TSX, CSS, API-client, and copy changes only require Metro.

If the phone cannot connect, confirm it is on the same Wi-Fi, disable conflicting VPNs temporarily, and allow ports 8080 and 8081 through the relevant firewalls.

## Development

Requirements:

- Go 1.25 or newer.
- Bun 1.3.5 or newer.
- Node.js LTS for Expo tooling.
- `ffprobe` for local audiobook ingestion.
- Docker if you want to build or run the production container.

Install dependencies and run the app:

```sh
cd app
bun install
cd ..
make dev
```

Useful commands:

```sh
make dev-server   # Go server on port 8080
make dev-app      # Expo development server
make expo-dev     # Metro for an installed native development client
make ios-dev      # Build and install the iOS development client
make build        # Production web export and Go build
make test         # Go, race, client, and TypeScript tests
make lint         # Go vet, formatting, and Expo lint
make acceptance   # Exact-progress cross-client acceptance test
make generate     # Regenerate sqlc and public TypeScript contracts
make docker       # Build the production container locally
```

The repository contains:

- `app/`: universal Expo client.
- `server/`: Go API and production web server.
- `tools/`: optional alignment worker and supporting tools.
- `docs/`: contributor documentation and test-fixture details.

The production image serves both the API and exported web client.

### Development configuration

Common server variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `ALDUS_ADDR` | HTTP listen address | `:8080` |
| `ALDUS_DATA_DIR` | Database and managed-data directory | `/data` |
| `ALDUS_MEDIA_DIR` | Managed ingest storage | `$ALDUS_DATA_DIR/media` |
| `ALDUS_SOURCE_ROOTS` | Comma-separated external Source roots | none |
| `ALDUS_MAX_UPLOAD_BYTES` | Maximum upload size | 2 GiB |
| `ALDUS_SECURE_COOKIES` | Require HTTPS cookies | `false` |
| `ALDUS_ALLOWED_ORIGINS` | Exact web-development origins | none |
| `ALDUS_LOG_LEVEL` | `debug`, `info`, `warn`, or `error` | `info` |

Prowlarr and qBittorrent may be configured in the app. Matching environment variables remain available as startup defaults for automated deployments.

Alignment development, frozen media fixtures, code generation, and internal architecture details live in [`docs/`](docs/) rather than this installation guide.

## Project status

Aldus is under active development. Back up your data, pin releases, and expect migrations as the product evolves.
