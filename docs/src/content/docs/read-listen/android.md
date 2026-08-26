---
title: Android
description: Read and listen with Aldus on Android.
---

Aldus on Android is the same app and library as every other platform, with a couple of Android-specific behaviors worth knowing: how background audio keeps running, and what to do before you lose signal.

<img
  class="docs-shot"
  src="/images/reader-epub.png"
  alt="Aldus ebook reader showing a chapter of Alice's Adventures in Wonderland with a Listen from here control"
/>

Connect to your server, open a title, and choose **Read** or **Listen**. Your position saves continuously, so switching apps or losing connectivity mid-page doesn't cost you your place.

## Background listening

Aldus runs audio through a foreground media playback service, which is what lets listening continue after you switch apps, lock the screen, or the device sleeps — Android requires an app to declare this explicitly, and Aldus does. You'll see a persistent media notification while audio is playing, with the book, chapter, and transport controls; use it or your device's lock-screen media controls to pause, resume, or skip.

<img
  class="docs-shot"
  src="/images/reader-audio.png"
  alt="Aldus audio player showing an audiobook chapter with playback speed, skip, and sleep timer controls"
/>

## Continue in another format

Titles with a **Read & Listen** indicator have a synchronized ebook and audiobook edition. From the work page, **Read instead** or **Listen instead** switches format and resumes at the same position — resolved through the alignment, not an estimated percentage. See [Exact synchronization](/read-listen/synchronization/).

## Before you lose signal

For travel or unreliable connections, download the title before leaving the network — look for **Download for offline** on the work page. See [Offline use](/read-listen/offline/) for exactly what gets stored on the device and what still needs a connection.
