# Aldus

**A self-hosted home for the books you own — ebooks and audiobooks, read together.**

Most people who own both an ebook and its audiobook edition live with two disconnected apps and no memory between them: close the book on your commute, lose your place when you pick up the audio that night. Aldus exists to fix that. It's a personal library server that finds your books, brings in the format you're missing, and keeps your exact position synchronized between reading and listening — down to the sentence, not just "roughly where you were."

It's built for the way a household actually keeps books: one person hosting it, everyone else just opening a title and reading or listening, without ever needing to know what a library, a source, or an indexer is. The people who administer Aldus get real controls — storage, download policy, permissions, backups. The people who just want to read get a calm, book-shaped app that gets out of the way.

> **Beta, heading toward a public release.** Aldus works today and is worth running for real — but it hasn't been through the long tail of edge cases yet. Pin a version, keep backups, and expect some rough corners while acquisition and sync keep settling.

## What Aldus actually does

- **One title, two formats, one place.** Search once and see ebook and audiobook availability side by side — not two separate apps pretending to be one.
- **Read↔listen sync that means it.** When a book's ebook and audiobook are aligned, switching from reading to listening resumes at the same point in the text, not an approximate percentage.
- **Ask for what's missing, without the busywork.** Request a format you don't have; Aldus searches, downloads, verifies, and imports it under rules the household owner sets — indexers, file sizes, and release names never surface to an ordinary reader.
- **A household, not just a user.** Libraries are access grants, not walls — most setups need zero configuration, and multi-library households (a shared collection plus a kids' library, say) get real isolation when they need it.
- **Bring what you already have.** Point Aldus at a folder of EPUBs and audio files and it imports them without renaming or rewriting a single file. Nothing you already own gets touched.
- **Read anywhere.** Native apps for iOS and Android, a full web app, and OPDS + KOReader credentials for e-ink devices — all backed by the same server and the same progress.
- **It's yours.** Self-hosted, your data, verified checksummed backups you can actually restore from.

## Try Aldus in five minutes

You need Docker with Compose support.

```sh
git clone https://github.com/mahcks/aldus.git
cd aldus
cp .env.example .env
docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080) and create the first account. That account becomes the administrator.

If you're testing a beta, pin it in `.env` before starting:

```dotenv
ALDUS_VERSION=0.1.0-beta.1
```

### Give it something to discover

Drop a few EPUB, MP3, M4B, or audiobook files into `library-media/`, then follow this short tour:

1. Open **More → Libraries** and create a library such as `Home`.
2. Open **More → Sources** and add `/library/media` to that library.
3. Start a scan.
4. Accept anything Aldus places in **Import review**.
5. Return to **Home** or **Discover** and open a title.

That's enough to explore covers, title pages, reading, listening, collections, and progress. You do **not** need Prowlarr or qBittorrent just to try the library and reader.

The included Compose file mounts `./library-media` read-only. Aldus indexes those files but does not rename, move, or rewrite them.

Maintainers building the public guest instance should use the reproducible catalog and VPS runbook in [`demo/`](demo/README.md); those media files are never bundled into the normal image.

## Choose how far you want to go

| I want to… | Set up… | Then explore… |
| --- | --- | --- |
| Browse books I already own | One Library and one Source | Home, Discover, and Collections |
| Read an EPUB | An imported EPUB | The title page, then **Read** |
| Listen to an audiobook | Imported MP3/M4B audio | The title page, then **Listen** |
| Test read/listen synchronization | Matching ebook and audiobook plus alignment | Switching formats without losing your place |
| Request missing formats | Prowlarr, qBittorrent, and library download rules | Discover and Activity |
| Use KOReader | A reader credential | Account → KOReader and OPDS |

## Set up automatic requests

This part is optional. Aldus currently uses:

- [Prowlarr](https://prowlarr.com/) to search your configured indexers.
- [qBittorrent](https://www.qbittorrent.org/) to download a selected release.

Open **More → Acquisitions**, connect both services, and test each connection. Then open **More → Libraries**, select a library, and configure its download rules:

- Default ebook and audiobook destinations.
- Maximum size for each format.
- Allowed file formats.
- Preferred language.
- Whether abridged audiobooks are acceptable.
- Maximum active requests per user.

Finally, choose what each member may do:

- **Can request:** request a missing ebook or audiobook.
- **Skip approval:** start a compliant request without waiting for an owner.
- **Advanced release choice:** inspect and choose raw releases instead of using Aldus's guided choice.

For ordinary readers, Aldus automatically applies the owner's rules. If nothing suitable exists yet, the request stays active and Aldus keeps watching — it never just dead-ends. Progress appears in **Activity**; approvals and technical problems appear under **More → Acquisitions**.

Usenet download clients are not supported yet.

## Your media stays understandable

Aldus supports two storage styles:

- **External media** stays in a folder you mounted as a Source. Aldus references it without modifying it. You remain responsible for backing it up.
- **Managed media** is copied from completed acquisitions into Aldus's data directory under generated safe names. Aldus verifies its size and SHA-256 checksum before import and leaves the original download alone.

For acquisitions, qBittorrent and Aldus must see the same completed-download folder. Set `ALDUS_DOWNLOAD_PATH` to the host folder qBittorrent uses, then set **qBittorrent download root** in Aldus to qBittorrent's container path (commonly `/downloads`). Aldus maps that path to its read-only `/downloads` ingress before copying or scanning the exact completed payload.

To mount different host folders, edit `.env`:

```dotenv
ALDUS_SOURCE_PATH=/path/to/your/books
ALDUS_BACKUP_PATH=/path/to/your/backups
```

Use the container path `/library/media` inside Aldus — not the original macOS, Windows, or Linux host path.

## Back up before experimenting

Create a verified online backup:

```sh
docker compose run --rm aldus backup \
  --archive /backups/aldus-backup-$(date +%Y%m%d).tar.gz
```

The archive includes the database, managed acquisition media, covers, alignment artifacts, and a checksum manifest. Prowlarr API keys and qBittorrent passwords are removed from the backup copy. External Source files are not included and need their own backup.

Restore while Aldus is stopped and `/data` is empty:

```sh
docker compose stop aldus
docker compose run --rm aldus restore \
  --archive /backups/aldus-backup-20260819.tar.gz \
  --data-dir /data
docker compose up -d
```

Restore with the Aldus version that created the archive, verify it, and then upgrade.

## Update or roll back

Pin the version you want in `.env`:

```dotenv
ALDUS_VERSION=0.1.0-beta.1
```

Then pull and restart:

```sh
docker compose pull
docker compose up -d
```

Take a backup first. To roll back, restore the matching backup and set `ALDUS_VERSION` to its previous value. Avoid `latest` for data you care about.

## Use Aldus away from the server

The web app works from any browser that can reach your Aldus server. The native iOS and Android apps are currently development builds; TestFlight, App Store, Play Store, and public EAS distribution are not configured yet.

For remote access, put Aldus behind an HTTPS reverse proxy or a trusted private network. When HTTPS terminates in front of Aldus, set:

```dotenv
ALDUS_SECURE_COOKIES=true
```

Finish creating the first administrator before exposing Aldus outside your home network.

### KOReader and OPDS

Create a credential under **Account → KOReader and OPDS**. Add the displayed `/opds/` URL as an OPDS catalog, use the Aldus origin as KOReader's custom progress server, and enter the generated username and password for both. Credentials belong to one user and can be revoked independently.

## When something does not work

### Aldus cannot see my books

- Confirm the host folder is mounted into the container.
- Add `/library/media` as the Source, not the host's original path.
- Confirm Docker can read the host folder.
- Check that `ALDUS_SOURCE_ROOTS` includes the server-visible path.

### A request does not start

- Test Prowlarr and qBittorrent under **More → Acquisitions**.
- Confirm the library has default destinations for the requested format.
- Check whether the request is waiting for approval.
- Review the size, format, language, and abridged rules.
- Read the plain-language status in **Activity**.

### A download finished but the title is unavailable

- Confirm `ALDUS_DOWNLOAD_PATH` points to the same host folder mounted into qBittorrent.
- In **More → Acquisitions**, set **qBittorrent download root** to qBittorrent's path for that folder, usually `/downloads`.
- Open **More → Sources → Import review**. Aldus asks for help when the completed payload is ambiguous, contains multiple books, or conflicts with an existing format.

### Is the server healthy?

- `/api/health` confirms the process is running.
- `/api/ready` checks SQLite and write access to the data directory.
- `/healthcheck` remains available for simple browser and LAN testing.

## Develop Aldus

You need Go 1.26+, Bun 1.3.5+, Node.js LTS, `ffprobe`, and Docker for production-image work.

```sh
cd app
bun install
cd ..
make dev
```

Common commands:

```sh
make dev-server   # Go server on port 8080
make dev-app      # Expo development server
make expo-dev     # Metro for an installed native development client
make ios-dev      # Build and install the iOS development client
make demo-media   # Fetch and verify the public-domain demo catalog
make build        # Production web export and Go build
make test         # Go, race, client, and TypeScript tests
make lint         # Go vet, formatting, and Expo lint
make generate     # Regenerate sqlc and public TypeScript contracts
make docker       # Build the production container locally
```

`make expo-dev` detects the LAN address on macOS and WSL. The phone, Metro machine, and Aldus server must still be reachable on the same network. Rebuild the native client only after changing native dependencies, Expo plugins, entitlements, or native configuration; ordinary TypeScript and styling changes only need Metro.

The repository is intentionally small:

- `app/` contains the universal Expo client.
- `server/` contains the Go API and production web server.
- `tools/` contains the optional alignment worker.
- `docs/` contains contributor notes, architecture details, and frozen-fixture documentation.

The production image serves both the API and exported web app. See [`docs/`](docs/) for implementation details.

## Where this is headed

The ambition is a complete, calm home for the books you own — one that treats reading and listening as one continuous act instead of two apps that happen to share a title. That's still being built. Acquisition, alignment, and the household permission model are the parts still hardening the fastest, so expect them to change shape a little before things settle.

If you run into something that doesn't add up, that's exactly the kind of report that's useful right now — Aldus is public enough to use for real, not yet old enough to have found all its own edges.
