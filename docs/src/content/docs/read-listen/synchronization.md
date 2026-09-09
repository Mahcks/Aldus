---
title: Switch between reading and listening
description: Keep your place when switching between an ebook and its audiobook.
---

Aldus can match the words in an ebook to its audiobook so you can switch between
reading and listening without losing your place. This matching process is called
**alignment**.

## Switch formats

Look for **Read & Listen** on the book page. This means the ebook and audiobook
have been matched and are ready to use together.

Choose **Continue reading** or **Continue listening** to pick up where you left
off. Choose **Listen instead** or **Read instead** to switch formats.
The progress bar shows your shared progress through the book.

## Choose where narration starts

On iPhone, iPad, or Android:

1. Press and hold a word in the ebook. Adjust the selection if needed.
2. Choose **Listen from here**.
3. The audiobook opens and starts from that part of the text.

This is more precise than switching from the book page, which uses the first
visible matched passage. Selecting text to copy it does not change your place.

When word timing is available, narration starts at the selected word. Older
alignments may only have sentence timing, so the starting point is approximate.
If Aldus cannot find a clear match, it keeps the ebook open and tells you that
listening is unavailable from that selection.

When you switch back to reading, Aldus opens the matching passage. It highlights
the passage when restoring your shared reading and listening position.

## How your place is saved

While reading, Aldus remembers the page you were viewing. It cannot tell which
word you last read on that page. Use **Listen from here** when you want to choose
an exact starting point.

While listening, Aldus saves your place regularly and when you pause or leave
the player.

Some ebook text may have no audio match, such as pictures, headings, or passages
the narrator skips. Aldus still remembers your ebook page. To switch to audio,
you may need to select a nearby passage that is narrated.

Aldus matches the text itself rather than assuming that the same percentage in
both formats means the same place. Introductions and differences between
editions can make those percentages misleading.

## Offline and other devices

Download the formats you want to use before going offline. Aldus saves your place
on the device and sends shared progress to your server when it reconnects.

If you also made progress on another device, Aldus may ask which position to
keep instead of replacing one silently.

Books without **Read & Listen** still save your place within the ebook or
audiobook, but cannot carry that place between formats.

## When a book is not ready to switch

A book needs both an ebook and an audiobook, and they must be matched before you
can switch between them. Having both files does not mean matching has finished.

If either file is replaced, the book needs to be matched again. The old match
may no longer point to the right words.

### For administrators: preparing a book

Open **Manage work → Sync** to manage the match between an ebook and its narration.
You can leave the page while the server works.

Long audiobooks can take hours to process, especially without a supported graphics
card. Where available, the book page shows the current step and time spent. These
steps take different amounts of time, so they do not give a reliable percentage
complete.

If matching stops or fails, check its status in **Manage work → Sync** before
retrying. Recovery options depend on your server version. Keep Aldus's data folder
when updating your server so saved books and job data are preserved.

For server setup and supported graphics cards, see
[Install Aldus](/admin/install/#whisperx-alignment).
