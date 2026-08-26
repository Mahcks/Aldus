---
title: Backups and upgrades
description: Back up Aldus before changing the server.
---

```sh
docker compose run --rm aldus backup \
  --archive /backups/aldus-backup-$(date +%Y%m%d).tar.gz
```

The archive includes the database, managed media, covers, and alignment artifacts. Credentials are scrubbed automatically.

Stop Aldus before restoring. Restore into an empty data directory, then run the matching Aldus version before upgrading further.
