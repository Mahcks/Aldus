---
title: Exact synchronization
description: Understand how Aldus preserves one reading position across ebook and audio.
---

Close the ebook on your commute. Open the audiobook that night. Aldus resumes at the same passage, without matching two unrelated percentages. This page explains what Aldus saves, how precise each interaction is, and how to choose the exact word where narration should begin.

<img
  class="docs-shot"
  src="/images/read-listen-sync.png"
  alt="Aldus work page showing an ebook and audiobook edition sharing one synchronized position, with Continue reading and Listen instead buttons"
/>

## What you see on a synchronized title

When a work has both a readable edition and a listenable edition, and Aldus has produced an alignment between them, the work page shows:

- A **Read & Listen** indicator near the title, so you know before you start that switching formats mid-book will work.
- A single progress bar and percentage — one position, shared by both formats, not two separate trackers.
- Two buttons: a primary one for whichever format you were last using (**Continue reading** or **Continue listening**), and a secondary **Read instead** or **Listen instead** for the other format.

Selecting the secondary button doesn't restart you at the beginning of the other format and doesn't estimate a percentage — it opens straight into the position the alignment resolves to.

## What Aldus saves

Aldus keeps two complementary positions:

1. **Your position in this edition.** The ebook keeps its complete Readium locator (or web CFI), while the audiobook keeps an integer millisecond timestamp. This is what reopens the same ebook page or audio time even when the title has only one format.
2. **Your shared read/listen position.** A synchronized title also keeps an alignment segment and an offset within that segment. The segment is usually sentence-sized. The offset records where you are inside it and is the only position used to move between ebook and audio.

Neither position is a book percentage. Percent complete is presentation only.

### When you turn or scroll a page

On iPhone and iPad, Aldus asks Readium for the first visible text location and saves that complete locator after the reader settles for about a second. Moving again replaces the pending save, so rapid page turns do not publish a trail of stale positions. Leaving with Aldus's Back button or sending the app to the background flushes the newest location immediately. Saves are serialized, and a revision conflict is refreshed and retried once.

Reopening the ebook therefore returns to the saved page and its first visible text anchor. It does **not** track your eyes. If you read halfway down a static page and close the app without selecting text, Aldus knows the page you were viewing, not the exact word you were looking at.

The edition position can save even when the visible text has no audio match. Chapter headings, images, and text omitted by the narrator still reopen correctly in the ebook, but they cannot replace the latest exact shared read/listen position. In that case Aldus keeps the last aligned passage and asks you to select narration text before switching to audio. It does not discard the page you just saved.

### When you listen

While audio is playing, Aldus saves approximately every two seconds. Pausing, switching back to reading, using Aldus's Back button, or backgrounding the app saves the current player timestamp immediately. On synchronized titles that timestamp is also converted to the shared segment and offset.

## Start listening from an exact word

On iPhone, iPad, or Android:

1. Long-press a word in the ebook and adjust the normal system selection if needed.
2. Choose **Listen from here** in the text-selection menu.
3. Aldus finds the one aligned sentence containing that selection and records the selection's starting character as the shared offset.
4. The reader closes, the player opens, and narration begins from the corresponding word timing.

The text selection is deliberate: selecting a word and choosing **Listen from here** is more precise than tapping the headphones button, which continues from the first visible synchronized passage. Simply selecting text for Copy or another system action does not change your saved position.

When validated word timings exist, Aldus seeks to the beginning of the selected word. If an older alignment has only sentence timing, Aldus interpolates within that sentence instead. If the selected text cannot be matched uniquely, Aldus stays in the reader and says that synchronized listening is unavailable there. It never guesses another passage.

Switching from audio to the ebook performs the reverse conversion: the current millisecond timestamp becomes a word offset when timing data is available, then Readium opens the aligned text near that word and highlights the resumed passage. The same highlight appears when Aldus restores a shared position from another device; reopening only an edition-specific page does not add one.

## Why it is not percentage matching

A naive sync maps "40% through the ebook" to "40% through the audiobook," which drifts badly when front matter, chapter lengths, or narration pacing differ between editions. Aldus maps specific ebook text to the audio interval that narrates it. Word timings refine that interval when they are available.

## Offline and multiple devices

Downloaded titles retain their edition locators on the device. Synchronized progress made offline is queued and reconciled when Aldus reconnects. If another device changed the same shared position first, Aldus shows a choice instead of silently overwriting it.

For a title without read/listen alignment, the ebook or audio locator still saves and restores within that format. It appears as **In progress**, but Aldus does not invent a shared percentage or cross-format position.

## When it isn't available

Not every title has synchronization. If a book only has one format, or an alignment hasn't been generated yet, the work page simply shows the one format available with no **Read & Listen** indicator. If the underlying ebook or audio edition changes after an alignment was produced, Aldus treats the old alignment as stale rather than silently applying a mapping that's no longer accurate for the new files — you'll see the single-format experience again until a fresh alignment is produced.

The standard Aldus image generates alignments with WhisperX on CPU. Administrators with a supported x86-64 Linux NVIDIA host can accelerate the same work without changing Aldus data or synchronization behavior. See [Install Aldus](/admin/install/#whisperx-alignment) for the one-command GPU option and hardware requirements.
