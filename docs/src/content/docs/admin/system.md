---
title: System diagnostics
description: Check the server, inspect failed background work, and create a support-safe diagnostic report.
---

Only a global administrator can open **More → System**. The page is a quick status view of Aldus itself; Prowlarr and qBittorrent connection tests remain under **Acquisitions**, and individual source or synchronization errors remain with the affected item.

## What the checks mean

- **Database** confirms SQLite is available and shows the current schema version.
- **Managed storage** confirms Aldus can write its data directory.
- **Source folders** compares configured roots with roots currently reachable by the server.
- **Source scans** and **Alignment jobs** show active and failed background work. Review a failed scan under **Sources** and a failed alignment under **Manage this work → Sync**.
- **Book acquisition** reports whether the optional Prowlarr and qBittorrent connection is configured.

Select **Check again** after correcting a mount, permission, or service problem.

## Download a diagnostic report

In a web browser, **Download diagnostic report** saves a JSON file containing the Aldus version and environment, schema version, service states, source-root counts, background-job counts, and whether acquisitions are configured. Aldus does not send the report automatically.

Review the file before sharing it and send it only through a private support channel. It does not contain media or connector credentials, but server state can still be useful to an attacker. See [Support](/support/) for what else to include and what to remove.

## Data and recovery

The same System page creates, downloads, and deletes verified backup archives. Keep a downloaded copy outside the Aldus host before deleting the last known-good archive. The complete contents, restore procedure, and credential behavior are documented under [Backups and upgrades](/admin/backups/).
