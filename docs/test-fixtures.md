# Test fixtures

## Alice's Adventures in Wonderland

The real-media fixture is frozen in `test-fixtures/alice/fixture.json`. Run:

```sh
make fixture
```

The fetch script downloads the exact files, checks their byte sizes, and refuses revisions whose SHA-256 differs. Media is stored in the ignored `test-fixtures/alice/media/` directory; it is not committed.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `alice.epub` | Project Gutenberg EPUB 3 with images, ebook 11 | 189231 | `6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c` |
| `alice-chapter-01.mp3` | LibriVox Version 7, Chapter 1, Craig Franklin | 6922917 | `6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a` |

Acquired 2026-08-11. Gutenberg declares the text public domain in the USA. LibriVox recordings are public domain. The audiobook release uses one MP3 per chapter; Aldus fetches only Chapter 1 (reported duration 864.31 seconds).

The EPUB package is `OEBPS/content.opf`; Chapter 1 is `OEBPS/6260297267691793459_11-h-1.htm.xhtml`. KOReader's `partial_md5_checksum` for the byte-identical EPUB is `efbf04efc9d43ecd89a033b329f49bdb`.

Do not replace either file by editing this metadata. Intentionally adopting a new upstream revision requires new hashes, a new fixture ID, new KOReader identity, and a new manual alignment.

## Current limitation

The ten sentence-level audio anchors have not been authored and verified by listening yet. The existing database seed remains the synthetic resolver test fixture, so it cannot be used as acceptance evidence for real-media synchronization. This is explicit to prevent guessed timings from becoming golden data.

## Authoring anchors

1. Run `make fixture`.
2. Run `make dev`.
3. Open `http://localhost:8081/anchors` (or append `/anchors` to the URL printed by Expo).
4. Highlight the exact intended text in the real EPUB and choose **Capture selection**. The tool preserves authoritative `Range.toString()` text separately from normalized matching text, both DOM boundary paths and offsets, and foliate's range CFI.
5. Play the Chapter 1 recording and find the matching spoken passage.
6. Use the ±5000, ±1000, and ±250 ms controls. The diagnostic retains the requested seek, player-reported position, and difference separately.
7. Use **Restore captured selection** and confirm the same exact text is visibly selected, then save the anchor. It remains in browser storage so the session survives reloads.
8. Repeat for at least ten passages distributed through Chapter 1.
9. Choose **Export JSON**, then replace `test-fixtures/alice/anchors.json` with the downloaded file. Review the diff; timestamps are human-authored evidence.
10. Run `make test`. `TestSavedAliceAnchors` validates every exported anchor in both directions and resolves the final locator to the exact EPUB passage.

The tool is web-only and developer-only. It cannot write the repository directly: exporting and reviewing the JSON is an intentional trust boundary.

## Capturing KOReader XPointers

1. Copy `test-fixtures/alice/media/alice.epub` directly to the KOReader device. Do not unzip, rebuild, convert, or pass it through Calibre.
2. Confirm the document hash is `efbf04efc9d43ecd89a033b329f49bdb`.
3. Configure KOReader's Progress Sync plugin for the Aldus server using `ALDUS_KOREADER_USER` and `ALDUS_KOREADER_KEY`.
4. Open the exact passage and trigger **Progress sync → Push progress**.
5. Inspect the request body sent to `PUT /syncs/progress` with a debugging proxy or temporary request logging. Copy `progress` verbatim; for reflowable EPUB it is KOReader's native XPointer.
6. Paste it into the anchor's **KOReader XPointer** field, then save and export again. Never derive it from foliate CFI or percentage.

Blank `koreader_xpointer` values are valid while capture is pending. They do not count as KOReader acceptance evidence.
