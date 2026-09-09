---
title: Exact synchronization
description: Understand how Aldus preserves one reading position across ebook and audio.
---

Close the ebook on your commute. Open the audiobook that night. Aldus resumes at the same passage, without matching two unrelated percentages. This page explains what Aldus saves, how precise each interaction is, and how to choose the exact word where narration should begin.

## What you see on a synchronized title

When a work has both a readable edition and a listenable edition, and Aldus has produced an alignment between them, the work page shows:

- A **Read & Listen** indicator near the title, so you know before you start that switching formats mid-book will work.
- A single progress bar and percentage — one position, shared by both formats, not two separate trackers.
- Two buttons: a primary one for whichever format you were last using (**Continue reading** or **Continue listening**), and a secondary **Read instead** or **Listen instead** for the other format.

Selecting the secondary button doesn't restart you at the beginning of the other format and doesn't estimate a percentage — it opens straight into the position the alignment resolves to.

## While alignment is running

The book page shows the current alignment stage and elapsed time for the selected
reading edition and narration. Administrators can choose **View sync details** to
open **Manage work → Sync**, cancel a queued or running job, or expand its history.
You can leave the page while the server works. If progress cannot be refreshed,
Aldus shows a connection message and retries automatically.

The bundled worker reports loading, transcription, word timing, text matching,
and validation stages. These stages are not equal portions of the work, so Aldus
does not display an estimated completion percentage. Long audiobooks can take
considerably longer on CPU. Older servers or custom workers without stage reporting
show a general preparation message instead.

## Interrupted alignment jobs

The bundled worker saves a checkpoint after transcription and another after word
timing finishes. When a job restarts or you retry it from **Manage work → Sync**, it
reuses matching completed stages. An interruption inside a stage repeats that
stage from its beginning; this is not chapter-by-chapter or mid-transcription resume.

Checkpoints are stored with the job artifacts in Aldus's persistent data directory.
Keep that directory mounted across container updates. They are bound to the source
hashes, extracted ebook text, model name, worker code, dependency versions, and
compute settings. A mismatch or damaged checkpoint causes that stage to run again.
Switching from CPU to CUDA invalidates existing checkpoints because the compute
settings differ. Final alignment validation still runs before readers can use it.

The server automatically retries an interrupted job once; after repeated interruptions,
use the existing retry action. A canceled job stays canceled until you explicitly
retry it. Checkpoints remain with the job for reuse and consume additional disk space.
Jobs started with an older worker have no checkpoints to recover.

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

## Worker diagnostics

Each worker attempt writes `stages.json` beside its job artifacts. It records the
active stage and its start time, completed-stage durations, model and compute
settings, and peak process memory sampled at stage boundaries. These measurements
separate model loading, transcription, word alignment, and text matching.

The file is updated atomically before each stage starts, so a timeout or killed
worker leaves its last recorded stage available. After a forced stop it can still
say `running`; use the server's job status to determine whether the job is active.
There is no within-stage heartbeat or GPU-memory measurement. A normal exception
records its type, and a retry replaces this file with the new attempt's diagnostics.
`runtime.json` remains the completed attempt's aggregate timing report.
