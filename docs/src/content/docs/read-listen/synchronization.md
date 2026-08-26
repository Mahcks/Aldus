---
title: Exact synchronization
description: Understand how Aldus preserves one reading position across ebook and audio.
---

Close the ebook on your commute. Open the audiobook that night. Aldus resumes at the same sentence — not an approximate percentage, not "close enough." This page covers what that looks like as a reader; see [Streaming architecture](/reference/streaming/) for how it's built.

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

## Why it's exact, not estimated

A naive sync maps "40% through the ebook" to "40% through the audiobook," which drifts badly the moment front matter, chapter lengths, or narration pacing differ between editions. Aldus doesn't do that. An alignment maps specific ebook text to the specific audio timestamp that narrates it, so switching formats lands on the sentence you left off on, not a proportional guess.

## When it isn't available

Not every title has synchronization. If a book only has one format, or an alignment hasn't been generated yet, the work page simply shows the one format available with no **Read & Listen** indicator. If the underlying ebook or audio edition changes after an alignment was produced, Aldus treats the old alignment as stale rather than silently applying a mapping that's no longer accurate for the new files — you'll see the single-format experience again until a fresh alignment is produced.
