# Aldus public demo

This directory is the reproducible input and deployment runbook for `demo.aldus.media`. Media and the golden backup stay out of Git.

## 1. Deploy cheaply on Fly.io

The checked-in `fly.toml` runs one auto-stopping shared CPU with 1 GB RAM and a 10 GB persistent volume in Chicago. Fly terminates HTTPS, so this deployment does not need Caddy. Install `flyctl`, sign in, then run from the repository root:

```sh
fly auth login
fly apps create aldus-demo
fly deploy --config demo/fly.toml --ha=false
fly ssh console --app aldus-demo --user root --command \
  "/opt/aldus-demo/fetch /data/demo-media"
```

Open `https://aldus-demo.fly.dev` for initial setup. The volume stores Aldus data and the public-domain media across deploys; the media is never included in an image. Fly may stop the Machine while idle and starts it on the next request.

## 2. Build the golden catalog

1. Open `https://demo.aldus.media` and create the owner.
2. Create a library named **Aldus Demo**.
3. Add `/library/demo` as a Source and enable automatic import for clear matches.
4. Scan it. The manifest contains 12 complete EPUBs and six complete audiobooks. Review ambiguous audiobook matches into the corresponding existing ebook Work; do not create duplicate Works.
5. Confirm covers, descriptions, chapter lists, seeking, and resume behavior for every imported Work. Use **Manage this work → Refresh metadata** and select the correct cover anywhere metadata is incomplete.
6. Generate the complete Alice read/listen alignment and exercise both handoff directions after a restart.
7. Create a persistent reader named for App Review, grant only the demo library, and disable all acquisition permissions. Store its credentials only in App Store Connect.
8. Open the demo library and copy its ID from the URL, then enable guest access with `fly secrets set --app aldus-demo ALDUS_DEMO_LIBRARY_ID=<library-id>`.
9. Verify `GET https://demo.aldus.media/api/setup/status` returns `"demo_available":true`, then use **Explore demo** twice and confirm the accounts cannot see each other's progress or collections.

Create the verified golden backup on the volume, download it, and store it privately:

```sh
fly ssh console --app aldus-demo --command \
  "aldus backup --data-dir /data/aldus --archive /data/aldus-demo-golden.tar.gz"
fly ssh sftp get --app aldus-demo \
  /data/aldus-demo-golden.tar.gz aldus-demo-golden.tar.gz
```

Rehearse restore against a separate empty Fly app/volume rather than overwriting the live demo. Keep the Compose files in this directory only as a local/VPS fallback.

Attach `demo.aldus.media` with `fly certs add --app aldus-demo demo.aldus.media`, then create the DNS records printed by Fly. Check issuance with `fly certs check --app aldus-demo demo.aldus.media`.

## 3. Monitoring

Point an external HTTPS monitor at `https://demo.aldus.media/api/ready`. Fly keeps daily volume snapshots for 14 days; the downloaded golden backup remains the recovery source. Do not add Prowlarr, qBittorrent, or acquisition settings to this deployment.

## 4. Apple review build

Bundle the native review build with:

```sh
EXPO_PUBLIC_API_URL=https://demo.aldus.media <your normal release build command>
```

This preloads the demo without locking the app to it. In App Store Connect, provide the persistent reviewer credentials and this walkthrough:

1. Open the preloaded demo and sign in with the reviewer account.
2. Search for **Alice's Adventures in Wonderland**.
3. Open the EPUB, change pages, close it, and resume.
4. Switch to the audiobook, open the chapter list, seek, close it, and resume.
5. Demonstrate read/listen handoff in both directions.
6. Browse Home and search, then add and remove a personal collection item.
7. Open Account to show **Switch server** without changing the active demo.

Before submission, restore the golden backup on an empty deployment and complete this walkthrough on iPhone, Android, and web.
