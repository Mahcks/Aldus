# Exact cross-format progress

This document defines the first Aldus synchronization contract. The Phase 1 proof uses a hand-authored alignment; automatic transcription is explicitly outside that proof.

## Canonical position

The only authoritative position is:

```json
{
  "work_id": "fixture-work",
  "alignment_id": "fixture-alignment",
  "segment_id": "s0002",
  "offset": 350000,
  "revision": 4,
  "updated_at": "2026-08-11T20:15:30.123Z",
  "source_device": "web"
}
```

`offset` is millionths through one aligned segment (`0..1000000`), not percentage through a book. A segment is normally sentence-sized. The alignment and segment identify the logical passage; offset preserves the normalized character position inside it. Validated word timings map that character position to a word onset. When word timings are absent, audio conversion interpolates within the segment interval. `revision` is the server-issued optimistic-concurrency version of progress, not an alignment revision.

Canonical progress belongs to a user and Work. Native state belongs separately to a user and Representation: for example an EPUB locator, audio timestamp, playback speed, reader layout, or zoom. Native state never creates or replaces canonical progress. Native locators are also retained on alignment segments for conversion; an adapter converts only between its native locator and `(segment_id, offset)`.

## Alignment and source revisions

An alignment is an ordered list of immutable segments tied to one EPUB media row and one audio media row. Both media rows contain the SHA-256 of the exact imported bytes. An alignment is usable only while those hashes still match. Reimporting changed bytes creates a media revision and leaves the old alignment stale; it is never silently rebound.

Each segment stores:

- stable ID and order
- normalized sentence text and optional surrounding text
- EPUB resource `href` and native locator JSON
- KOReader XPointer for that same EPUB revision
- audio resource and inclusive start/exclusive end milliseconds
- optional word timing JSON for word-level audio conversion

Audio conversion uses the segment time interval and linearly preserves the canonical offset. EPUB and KOReader conversion returns the stored sentence locator plus the offset. Phase 1 guarantees the same sentence, not character-level placement.

## Locator adapters

### iOS

Use Readium Swift Toolkit. Aldus asks the navigator for its first visible element locator and persists that complete Readium `Locator` JSON. The locator restores the edition position. Its text context may also resolve the first visible aligned passage, but the page save is not eye tracking. A custom native selection action maps the selected text's starting character to a canonical segment offset before a read-to-listen handoff.

### Android

Use Readium Kotlin Toolkit. Observe `Navigator.currentLocator`, serialize the complete Readium `Locator`, and restore it with the navigator. The same custom selection action maps selected text to a canonical segment offset.

### Web

The web proof uses `foliate-js` 1.0.1. It is maintained, has no runtime framework dependency, accepts the frozen EPUB bytes directly, emits EPUB CFI from the visible DOM range, and restores a CFI through `goTo`. Aldus keeps that CFI as adapter data; canonical state remains segment plus offset. Scripted EPUB content is unsupported. Selection is provisional until the ten real-media anchors pass restore testing in a browser.

The server importer deliberately implements only the frozen EPUB's container, OPF manifest/spine, and XHTML paragraphs. Each normalized paragraph retains its real resource href and DOM path (`body/div[1]/p[n]`). Import calculates SHA-256 from the untouched file. The original ZIP is served to the renderer and must remain byte-identical.

Real audio is served with standard HTTP range support and played by `expo-audio`. Its API reports and seeks seconds, while the Aldus adapter converts to integer milliseconds. Actual decoder seek error is not yet recorded because manual golden timing acceptance remains outstanding.

### Audiobook

The native locator is `{resource, timestamp_ms}`. Timestamps remain integer milliseconds. Timestamp-to-canonical finds the containing segment and derives its offset. Canonical-to-timestamp interpolates within the same segment. Gaps clamp to the nearest segment boundary; timestamps outside the aligned range are rejected.

### KOReader

Aldus implements KOReader's current custom progress server endpoints: `GET /users/auth`, `PUT /syncs/progress`, and `GET /syncs/progress/{document}`, using the `application/vnd.koreader.v1+json` contract and `x-auth-user`/`x-auth-key` headers. A user creates a separate reader credential for each device under **Account → KOReader and OPDS**. The credential authenticates the adapter, and library membership authorizes the mapped Work.

For reflowable EPUB, KOReader's `progress` value is its exact XPointer and is retained verbatim. `percentage` is returned for protocol compatibility only. KOReader identifies the document with `partial_md5_checksum`: MD5 over up to 1 KiB at offset 0, then offsets 1024, 4096, and each successive offset multiplied by four, stopping when a read returns no bytes. The frozen Alice EPUB vector is `abb11be65399f96116fd90ab861dda0e`. Import records this protocol identity alongside Aldus's full SHA-256. Because partial MD5 samples the file rather than hashing every byte, duplicate aliases are treated as ambiguous and fail closed instead of being silently rebound.

The KOReader adapter stores one native `(document alias, XPointer)` state per user and EPUB, so ordinary KOReader synchronization works without an audiobook or ready alignment. When a ready alignment can resolve the XPointer exactly, the adapter also updates canonical segment-plus-offset progress. Pulling after a newer audiobook or Aldus-reader update returns the aligned segment's KOReader XPointer. Unrecognized document identities fail; an unrecognized locator remains valid native KOReader state but is never used to invent a canonical position.

## Progress conflict semantics

There is one canonical progress row per user and Work. `GET` and `PUT /api/v1/works/{workID}/progress` read and update it; an update names the validated alignment explicitly. A client reads revision `N` and updates with `expected_revision: N`. The server commits `N+1` atomically. A mismatched revision returns `409 Conflict` and the current position; it never silently overwrites it. A new client starts with expected revision `0`. KOReader's protocol has no revision field, so its adapter performs a bounded retry against the newest revision and reports success only after the accepted native state has been saved.

There is separately one native-state row per user and Representation at `GET` and `PUT /api/v1/representations/{representationID}/state`, with its own optimistic revision. If an alignment becomes stale, Aldus preserves the exact canonical row and reports it as unresolved instead of rebinding or interpreting it against another revision. Native state remains writable even when no canonical mapping can be resolved.

This is deliberately not a CRDT. A user resolving a conflict submits again against the returned current revision.

## Database

SQLite owns works, immutable media revisions and hashes, alignments, segments, native locators, KOReader aliases and native progress, per-user canonical progress, and per-user Representation state. Foreign keys and uniqueness constraints protect revision identity. Ordered embedded SQL migrations initialize the database; there is no ORM.

## Automatic alignment

Alignment is preprocessing, never playback work. WhisperX 3.8.6 is the adopted MVP candidate: its word starts met the frozen Alice audible-onset target while exact EPUB restoration remained 10/10. The boundary remains a Go-owned local subprocess that accepts exact EPUB/audio paths and emits a versioned alignment document. Go validates monotonic segment order, media bounds, overlap, unmatched ranges, coverage, source hashes, and tool/schema versions before one transaction marks an alignment `ready`. Low-confidence or unresolved mappings fail closed to ordinary playback. No Redis, queue service, or distributed worker is planned.

## Exactness and failure cases

Exact DOM-range restoration is validated against the frozen Alice EPUB. Automatic spoken onset uses the separately human-authored audible-onset fixture; manual-seek anchors retain their distinct restoration/listening-position semantics. A deliberate text selection preserves the starting character within its aligned segment and seeks to the corresponding word onset when validated timing exists. Ordinary page navigation preserves the renderer's first visible location, not the reader's unseen eye position. Exact word highlighting still requires validated word timing for that segment.

Canonical resolution fails closed when a source hash changed, an alignment is not ready, a document alias is unknown or ambiguous, a locator has no exact segment mapping, a timestamp is out of bounds, segment ordering is non-monotonic, or a client revision is stale. Native KOReader progress remains available when only the canonical mapping is unavailable. Text quotes are recovery evidence for diagnostics and future controlled re-anchoring, never permission to reuse an alignment against changed media.

## Research basis

- [KOReader client protocol and XPointer behavior](https://github.com/koreader/koreader/tree/master/plugins/kosync.koplugin)
- [KOReader reference sync server](https://github.com/koreader/koreader-sync-server)
- [Readium Kotlin navigator and persisted locators](https://readium.org/kotlin-toolkit/latest/guides/navigator/navigator/)
- [Readium Swift Toolkit](https://github.com/readium/swift-toolkit)
- [Storyteller forced-alignment pipeline](https://storyteller-platform.dev/docs/the-algorithm/)
