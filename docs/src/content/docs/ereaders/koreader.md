---
title: KOReader
description: Connect KOReader to Aldus for books and reading progress.
---

KOReader can sync reading progress against Aldus using its built-in progress-sync plugin, pointed at your Aldus server instead of the default KOReader cloud. Setup happens in two places: Aldus generates a credential, then you enter it into KOReader.

## Create a credential in Aldus

1. Sign in to Aldus and open **Account**.
2. Under **KOReader and OPDS**, give the credential a **Device name** you'll recognize later — for example, the name of your e-reader — and select **Create reader credential**.
3. Aldus shows the credential once: a **Username** (your own Aldus username), a generated **Password**, an **OPDS catalog** URL, and a **KOReader sync server** address. Save the password now — Aldus does not show it again.

<img
  class="docs-shot"
  src="/images/koreader-credential.png"
  alt="Aldus account screen showing a newly created reader credential with username, password, OPDS catalog URL, and KOReader sync server address"
/>

A credential grants access only to your own libraries and reading progress, not the whole server, and each device should get its own so you can revoke one without affecting another.

## Enter it into KOReader

In KOReader, open the progress-sync plugin (menu names vary by version, but look for something like **Settings → More tools → Progress sync**, or a cloud/sync icon in the file browser toolbar). Choose to use a custom sync server rather than the default, then enter:

- **Server address**: the **KOReader sync server** value from Aldus — this is your server's own address, not a separate sync endpoint.
- **Username**: your Aldus username.
- **Password**: the generated password from the credential you just created.

Once connected, KOReader will push and pull reading progress for books it recognizes as matching your Aldus library.

## Keep it private

The credential's password grants access to your reading activity for as long as it's valid — treat it the way you'd treat any password, and don't share it or commit it anywhere.

## Revoke a credential

If a device is lost, replaced, or no longer used, open **Account** in Aldus, find it under **KOReader and OPDS**, and select **Revoke**. Access ends immediately; KOReader on that device will no longer be able to sync until you set it up again with a fresh credential.
