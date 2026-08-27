---
title: iPhone and iPad
description: Read and listen with Aldus on iOS and iPadOS.
---

Aldus on iOS and iPadOS is the same app and the same library as every other platform — what differs here is how it behaves as a native iOS citizen: background audio, lock-screen controls, and the local-network permission prompt.

<img
  class="docs-shot"
  src="/images/reader-epub.png"
  alt="Aldus ebook reader showing a chapter of Alice's Adventures in Wonderland with a Listen from here control"
/>

Open a title and choose **Read** or **Listen**. In the ebook, Aldus saves the first visible text location after the page settles and flushes it when you leave or background the app. In audio, it saves approximately every two seconds and immediately when you pause, leave, switch formats, or background the app.

## Continue in another format

When a title shows the **Read & Listen** indicator, a synchronized edition is available. Tap the headphones button to continue from the first visible synchronized passage. For a precise handoff, long-press a word, adjust the iOS text selection, and choose **Listen from here**. Aldus opens the player at that word when validated word timing is available. See [Exact synchronization](/read-listen/synchronization/) for the complete saving and precision contract.

<img
  class="docs-shot"
  src="/images/reader-audio.png"
  alt="Aldus audio player showing an audiobook chapter with playback speed, skip, and sleep timer controls"
/>

## Background listening

Audio keeps playing when the screen locks or you switch to another app — Aldus configures the session for background playback on launch, so this isn't something you need to turn on. Use the lock screen or Control Center's media controls to pause, resume, or skip; they reflect the book and chapter you're listening to.

## Local servers

The first time you connect to a server on your home network, iOS will prompt for local-network access. Aldus asks for that permission only to reach the server address you connect it to — it doesn't scan your network or discover other devices. If you decline the prompt, connecting to a local (`http://192.168.x.x`) server will fail until you grant it in **Settings → Aldus → Local Network**.
