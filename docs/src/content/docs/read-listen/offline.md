---
title: Offline use
description: Keep books available when your Aldus server cannot be reached.
---

While connected to your server, open a title and select **Download for offline**. Aldus stores what it needs on the device so you can read or listen without a connection, and reverses the process with **Remove download (on this device)** when you're done.

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
