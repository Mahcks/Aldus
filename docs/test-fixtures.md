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

The EPUB package is `OEBPS/content.opf`; Chapter 1 is `OEBPS/6260297267691793459_11-h-1.htm.xhtml`. KOReader's `partial_md5_checksum` for the byte-identical EPUB is `abb11be65399f96116fd90ab861dda0e`.

Do not replace either file by editing this metadata. Intentionally adopting a new upstream revision requires new hashes, a new fixture ID, new KOReader identity, and a new manual alignment.

## Benchmark semantics

`anchors.json` contains ten human-authored manual seek positions and exact EPUB ranges. It remains the immutable fixture for locator restoration and manual Read → Listen / Listen → Read behavior. It is not word-onset ground truth.

`onset-anchors.json`, once exported, is a separate human-authored fixture for the earliest audible beginning of each opening word. Never derive it from WhisperX, waveform diagnostics, or the existing manual timestamps.

## Authoring anchors

The authoring screens are intentionally excluded from the production router. Before starting a maintainer session, copy them into the local route tree; these route copies are Git-ignored:

```sh
cp app/src/maintainer/anchors.tsx app/src/app/anchors.tsx
cp app/src/maintainer/onsets.tsx app/src/app/onsets.tsx
```

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

The tool is web-only and developer-only. It cannot write the repository directly: exporting and reviewing the JSON is an intentional trust boundary. Delete the two temporary route copies when the session ends.

## Authoring audible-onset anchors

1. Run `make fixture` and `make dev`.
2. Open `http://localhost:8081/onsets` (or use the port printed by Expo).
3. The page reuses valid Alice anchors saved by `/anchors`. If they are unavailable, choose **Import anchors.json** and select `test-fixtures/alice/anchors.json`.
4. Choose a 100, 250, 500, or 1,000 ms audition length. Use **Play before boundary** and **Play after boundary** with the ±500, ±100, and ±25 ms controls. Narrow toward 100 ms until the before slice has no opening-word sound and the after slice begins with it.
5. Find the earliest point where the opening word audibly begins. Do not annotate word completion or the point where the word becomes recognizable.
6. Add a note describing what was heard at the boundary and confirm that the choice was made by listening. Model output is intentionally absent from the authoring control.
7. Save all ten passages, then export `onset-anchors.json` to `test-fixtures/alice/onset-anchors.json`.
8. Evaluate the completed fixture from `server/`:

   ```sh
   go run ./cmd/alignment-experiment onset-evaluate \
     --manual ../test-fixtures/alice/anchors.json \
     --onsets ../test-fixtures/alice/onset-anchors.json \
     --boundaries ../test-fixtures/alice/automatic/whisperx/boundary-analysis.json \
     --output ../test-fixtures/alice/automatic/whisperx/onset-evaluation.json
   ```

The output compares WhisperX word start and the fixed waveform-energy diagnostic with the human audible-onset timestamps. Do not run or report this benchmark until all ten human annotations exist.

## Capturing KOReader XPointers

1. Copy `test-fixtures/alice/media/alice.epub` directly to the KOReader device. Do not unzip, rebuild, convert, or pass it through Calibre.
2. Confirm the document hash is `abb11be65399f96116fd90ab861dda0e`.
3. In Aldus, create a reader credential under **Account → KOReader and OPDS** for an enabled user with access to the fixture library. Configure KOReader's custom Progress Sync server with the displayed server address, username, and generated password. Keep **Document matching method → Binary** selected.
4. Open the exact passage and trigger **Progress sync → Push progress**.
5. Inspect the request body sent to `PUT /syncs/progress` with a debugging proxy or temporary request logging. Copy `progress` verbatim; for reflowable EPUB it is KOReader's native XPointer.
6. Paste it into the anchor's **KOReader XPointer** field, then save and export again. Never derive it from foliate CFI or percentage.

Blank `koreader_xpointer` values are valid while capture is pending. They do not count as KOReader acceptance evidence.
