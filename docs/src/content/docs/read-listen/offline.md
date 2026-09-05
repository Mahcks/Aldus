---
title: Offline use
description: Keep books available when your Aldus server cannot be reached.
---

Offline downloads are available in the iOS and Android apps. The web app requires a connection to its Aldus server.

While connected in a mobile app, open a title and select **Download**. Choose **Ebook only**, **Audiobook only**, or **Both** for a paired title; each option shows its size. Adding a format keeps files already saved on this device.

## Pause, resume, or cancel a download

The title page and **Account** show downloads saved for the current server and account, including interrupted transfers. Each file shows its downloaded size and status. Keep Aldus open while downloading; finishing transfers in the background is not guaranteed.

- **Pause** keeps verified downloaded chunks. **Resume download** continues from the last saved chunk, including after restarting Aldus.
- A lost connection keeps verified chunks too. Resume when the server is reachable again.
- **Cancel download** removes unfinished bytes. A successfully downloaded ebook is kept if its paired audiobook fails; retry reuses it.
- **Saved** beside a file means that file finished. A title is available offline only after every selected file and its reading metadata have finished saving.

Downloads use up to two transfers at once. A server that ignores resume requests can supply a fresh complete file safely. If the app stops during a chunk checkpoint, Aldus may restart that file to avoid trusting incomplete bytes. Downloads do not currently enforce Wi-Fi-only use.

Use **Remove ebook** or **Remove audiobook** beside a saved file on the title page or in **Account**. Removing one format keeps the other available offline. Aldus asks you to sync pending reading progress before removing a download or replacing a downloaded edition.

## What gets stored on the device

A download is more than just the file:

- The ebook and/or audiobook edition you selected, including chapter and cover metadata.
- If the title has a **Read & Listen** alignment, the alignment data itself — so switching between formats works offline exactly the way it does online, landing on the same sentence rather than an estimate.
- Your current progress at the moment of download. Edition-specific ebook and audio locations continue saving on the device. Shared progress for synchronized titles is queued while offline.
- Your most recently synced reading defaults and any settings saved specifically for the downloaded edition.

Because the alignment travels with the download, exact synchronization isn't an online-only feature — a fully downloaded synchronized title keeps working the same way with no connection at all.

## What still needs a connection

Anything not downloaded — other titles in the library, cover art you haven't opened yet, new acquisitions, account and library management — requires reaching the server. Downloads are per-device and per-server: books and progress for one connected server stay separate from any other server you've connected Aldus to.

## How progress reconciles

For synchronized titles, the latest shared segment and offset is queued on the device rather than lost. The next time Aldus can reach the server, it sends that position and reconciles it against whatever was most recently saved there, so picking up on another device in the meantime doesn't get silently overwritten by a stale offline session. The downloaded edition locator also remains available locally, including for books that do not have an alignment.

## Shared or public devices

Downloaded media and progress live on the device itself. If you're using Aldus on a shared or public device, remove your downloads before signing out — signing out doesn't clear them for you.
