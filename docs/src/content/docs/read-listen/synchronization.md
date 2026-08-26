---
title: Exact synchronization
description: Understand how Aldus preserves one reading position across ebook and audio.
---

Aldus does not synchronize EPUB percentages directly with audiobook timestamps. An alignment maps both formats to one canonical position: an alignment segment plus an offset inside that segment.

The mapping is valid only for the exact ebook and audio revisions used to produce it. If either source changes, Aldus marks the old alignment stale rather than silently applying an inaccurate position.
