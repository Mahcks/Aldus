# Alignment release corpus v1

Defined against commit `306a05a6aad15f5fbf01eafdad4c1a43adfed993`.
This is a maintainer test specification, not a record of passing results.

Scope: English EPUB/narration pairs, exact passage restoration, selected-word
handoff, and safe refusal when text is not narrated. Other languages need their
own corpus before this evidence can support them.

## Cases

Reuse the identities and source metadata in [demo/catalog.json](../../demo/catalog.json).
The four full-book pairs are candidates for validation, not already verified
matching editions. Check their actual content before classifying annotated passages.

| ID | Input | Purpose | Current evidence |
| --- | --- | --- | --- |
| alice-ch01-control | Existing pinned Alice EPUB and Craig Franklin chapter-one MP3 | Preserve the ten-anchor baseline | Historical results only; rerun candidate |
| alice-full | Alice EPUB + Vin Cramer version 8 M4B | Whole-book progression and a different narrator | Media identity pinned; annotations pending |
| pride-full | Pride and Prejudice EPUB + Karen Savage version 3 M4B | Longer continuous narration and chapter transitions | Media identity pinned; annotations pending |
| frankenstein-full | Frankenstein EPUB + John Van Stan version 4 M4B | Letters/frame narrative; inspect edition differences | Media identity pinned; annotations pending |
| dracula-full | Dracula EPUB + collaborative M4B | Multiple narrators and changes of section | Media identity pinned; annotations pending |
| wrong-book | Alice EPUB + Pride and Prejudice M4B | Clearly unrelated inputs must not produce confident handoffs | Uses pinned inputs; evaluation pending |
| omitted-passage | Derived Alice EPUB + unchanged full Alice M4B | Same-title partial mismatch; safely handle text without narration | Derivation and anchors pending |
| repeated-passage | Derived Alice EPUB + unchanged full Alice M4B | Distinguish identical text at different EPUB locations | Derivation and anchors pending |
| timing-gap | Synthetic worker word timings based on an annotated Alice passage | Reject implausibly stitched matches without rejecting ordinary pauses | Test construction pending |

Do not substitute the full Alice M4B for the original chapter-one MP3: narrator,
timestamps and source hashes differ. Keep all existing Alice fixtures immutable.

### Frozen full-book inputs

Paths below are relative to the demo media directory. Byte sizes, URLs and source
provenance are in the catalog at the commit above. These hashes freeze corpus v1
even if the demo catalog later changes. An upstream hash mismatch blocks that
input; do not quietly update its hash or reuse annotations from different bytes.

| File | SHA-256 |
| --- | --- |
| `alice/alice.epub` | `6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c` |
| `alice/alices-adventures-in-wonderland-librivox-v8.m4b` | `a74d661f909a8c11f0a04dbbab387ba00c66464753bba93a3d0393b1195c7e81` |
| `pride-and-prejudice/pride-and-prejudice.epub` | `2c1a5bce2f7fb394609372442c56c49d87e87b94657ccf90c2b90b571a9dfed6` |
| `pride-and-prejudice/pride-and-prejudice.m4b` | `8551ca09538db88923355e7afda0c848e63fe50101002d5f63722dadfcfc03b9` |
| `frankenstein/frankenstein.epub` | `dd7ec02d2c8db4162bf587aa09a692ed5394ead3dfb12d8cc14b449d89795a6a` |
| `frankenstein/frankenstein.m4b` | `08ffa55a81533d44fbdbc4dc67686c7f09f04ab3ea30d47fabba9f85e0f444f4` |
| `dracula/dracula.epub` | `8a275fd1e858a9a873ca857592b48cca3183ccff7b561fa5cb03a4fabca054dc` |
| `dracula/dracula.m4b` | `cf57d8379885c8d337c8fddacb4d4844bb141077fb38741f042f6220efd51400` |

For preparation, `make fixture` verifies/installs the original local control.
`make demo-media` downloads and verifies the entire demo catalog, not just these
four pairs. Use it only when preparing media; this specification did not download
or run the full books. Keep downloaded media and run artifacts out of Git.

## Human ground truth

Select **24 distinct narrated passages per full book before viewing model output**:

- Twelve spread over twelve equal-duration audio regions, including near the
  beginning and end of narrated book content.
- Six immediately before/after three chapter or section transitions distributed
  through the book, including a narrator change where present.
- Six difficult passages: dialogue, repeated wording, a long natural pause,
  punctuation/short sentences, or narration beside skipped text. Record which
  characteristic each passage covers; do not invent a characteristic absent from
  that recording. Use another difficult passage and note the substitution.

Additionally mark at least three non-narrated or edition-mismatch passages per
book where present. These are negative cases, outside the 24 narrated passages.
If none exist, record that fact; the derived cases still exercise refusal.

For each anchor, record a stable ID, EPUB/audio hashes, exact selected text,
normalized text, EPUB resource, DOM range/CFI, occurrence identity, opening word,
audible-onset timestamp, annotator/date and listening notes. For a negative anchor,
record the reason no match exists instead of fabricating an onset timestamp.

Use the existing [anchor-authoring semantics](../../docs/test-fixtures.md).
Onset means the earliest audible beginning of the word, not recognition or word
completion. Manual comfortable-seek timestamps remain a separate measurement.
Never derive ground truth from ASR, forced alignment, waveform heuristics or a
fixed offset. Repeat the onset annotation independently without the first labels
or model output visible, preferably with another listener. Differences over
100 ms require replay and a recorded resolution before scoring. Preserve both
raw passes. Unresolved annotation disagreements make the case incomplete.

### Derived cases

Use new fixture IDs and output hashes. Never edit the frozen source EPUB/audio.
Commit the small reproducible transform and transformation metadata when creating
each case; record the base hashes, resource/range, inserted text and derived hash.

- **Omitted passage:** insert a clearly identified, unique paragraph from the
  pinned Pride EPUB into the body of a middle Alice chapter. Keep the audio
  unchanged. Annotate the inserted paragraph as not narrated and two genuine
  Alice passages on each side as positive controls. This is a controlled partial
  mismatch, not evidence for all real abridgements or alternate editions.
- **Repeated passage:** copy one annotated Alice paragraph to a distant chapter,
  leaving its original occurrence intact and the audio unchanged. The original
  location must map to its narration; the added occurrence must not borrow that
  timestamp. Capture both locators and nearby positive controls. Text equality
  alone cannot identify which occurrence was restored.
- **Timing gap:** construct high-confidence, high-coverage matched words with an
  implausible internal separation (initial adversarial example: 30 seconds across
  unrelated narration). Pair it with an ordinary-pause control from the human
  corpus. Require rejection of the unsafe stitched match, not blanket rejection
  of all long silences. Thirty seconds is a test input, not a proposed production
  cutoff; select the actual criterion only after measuring natural gaps.

## Pass criteria fixed before candidate measurement

These are engineering acceptance targets for corpus v1, not achieved results or
a claim of statistical coverage of all books. The 250 ms median target comes from
the existing onset benchmark; the coverage and tail limits below are new release
targets. Do not loosen them after seeing a candidate without a recorded policy
change and a new corpus/protocol version.

| Measure | Required result |
| --- | --- |
| Input binding | Every artifact and annotation refers to the exact selected media hashes; stale/changed inputs cannot reuse the match |
| Narrated-anchor coverage | At least 23 of 24 narrated anchors yield an exact eligible handoff **in each book**; unresolved anchors stay in the denominator |
| Per-section coverage | At least one successful positive anchor in each of the twelve duration regions; no entire sampled region may disappear behind an aggregate score |
| Onset accuracy | Per book, median absolute error ≤250 ms, nearest-rank p95 ≤500 ms, maximum ≤1,000 ms over eligible positive anchors |
| Wrong passage/occurrence | Zero eligible handoffs to the wrong passage or duplicate occurrence, regardless of timestamp proximity |
| Negative cases | Zero eligible exact handoffs from the labeled non-narrated passages or wrong-book pair; independent reading/listening remains usable |
| Restoration | Every eligible anchor restores the intended visible passage and exact selected occurrence in both handoff directions; 100% of attempted eligible restores pass |
| Existing control | All ten original Alice locator restores pass; onset timing is scored against the separate audible-onset labels and the timing limits above |
| Unsafe timing | The adversarial stitched match is not highlightable/eligible; genuine pause controls remain eligible and pass restoration |
| Lifecycle | Full-book processing completes on the declared baseline hardware within the configured timeout, without OOM; cancellation/restart cannot publish partial or stale artifacts |

Report unresolved and incorrect anchors separately. Wrong but confident matches
are failures, not missing observations to drop from a percentile. For `n` eligible
anchors, nearest-rank p95 is sorted absolute error at one-based index `ceil(.95*n)`.
Report results per book and per case before any pooled summary.

For each full book also report text-wide eligible/unresolved segment counts by
chapter. These are diagnostic coverage measures, not human-verified accuracy:
segment counts cannot substitute for the independently labeled anchor denominator.

Measure requested/player-reported seek separately from audible output. A zero
media API seek difference does not establish audible onset. Check browser and
physical iOS playback/restoration on the distributed candidate using the existing
[physical acceptance matrix](../../docs/product-mvp-acceptance.md).

## Run record and hardware

Before execution, record candidate commit, image digest/app build, worker/model
versions, media/annotation hashes, CPU/RAM or GPU/VRAM, OS, processing settings,
timeout and whether caches/checkpoints were present. Use a disposable Aldus data
directory and the normal server-owned job lifecycle; Python must not access SQLite.

Record total audio duration, wall time, wall-time/audio-duration ratio, peak memory,
peak GPU memory where relevant, and additional disk consumption per book. Separate
first-start/model preparation from warm execution; record interrupted/resumed runs
separately. Do not claim a GPU result from an image build or CPU fallback. The normal
configured timeout is the completion bound; this protocol does not yet establish
minimum supported host resources or a promised processing speed.

Keep a per-case record under ignored `artifacts/alignment-corpus/<candidate>/` with
status `pending`, `pass` or `fail`, the measurements above, output artifact, anchor
results, screenshots/observations, and reasons for every unresolved or failed case.
No annotations, missing media, an unrun physical check, or a timeout means the
required case has not passed. A whole-corpus pass requires all applicable rows.

## Authoring and evaluation

The maintainer `/anchors` and `/onsets` pages now select the control or any of the
four full books. Follow [local route setup](../../docs/test-fixtures.md#authoring-anchors),
then choose **Annotation fixture**. For every fixture, choose its local EPUB and
audiobook. Both SHA-256 hashes must match before the workspace opens. Files stay
in the browser; hashing currently buffers one file (maximum 1 GiB).

Saved anchors and onsets are isolated by fixture ID and media hashes. Reloading
requires choosing the local files again. Export each fixture before ending the
session. The original Alice control keeps its existing storage keys and exports;
do not overwrite its frozen repository evidence when creating corpus annotations.

Capture complete paragraphs for production alignment artifacts. The evaluator
requires the same EPUB href, the same DOM range for range artifacts, or both
selection boundaries inside the production element with identical complete text.
It never chooses the first matching text. Partial-paragraph selections that cannot
be grounded to the candidate remain unresolved; duplicate matching locations are
ambiguous. Browser restoration still needs a separate visible check.

The onset page accepts any nonempty anchor count and only exports after every
passage has a human onset. New onset exports include the passage range; changing
an anchor's range or manual timestamp invalidates its saved onset. Legacy Alice
annotations remain readable. Keep model output out of human annotation sessions.

Run from the repository root, with the actual exported and candidate paths:

```sh
python3 tools/alignment.py evaluate \
  --candidate candidate.json --anchors alice-full-anchors.json \
  --output evaluation.json
python3 tools/alignment.py onset-evaluate \
  --candidate candidate.json --manual alice-full-anchors.json \
  --onsets alice-full-onsets.json --output onset-evaluation.json
```

Both commands bind the input hashes and accept arbitrary anchor counts. Reports
include unresolved counts and measured coverage; absent timestamps are null, not
zero-error successes. Timing percentiles use only resolved positive anchors, so
check coverage separately. `evaluate` supports `expected_match: false` in an
anchor for an explicit negative case; it requires safe refusal at that location.
Ambiguity does not count as refusal. The authoring pages produce positive anchors;
review negative-case metadata separately against the case protocol above.

The browser `tools/alignment-acceptance.js` runner remains the original Alice
control. It now uses the same locator/hash evaluator before restoring saved ranges.
Full-book restoration and handoff checks remain manual. `onset-evaluate --boundaries`
retains the old Alice diagnostic; newly generated boundary files carry media hashes.

## Remaining execution order

1. Verify the selected media and inspect edition compatibility. Record unavailable
   inputs instead of substituting different bytes.
2. Capture the 96 positive human anchors, negative passages and repeat annotations.
   Create and hash the two derived EPUBs and synthetic timing case.
3. Run production alignment on each complete book and negative case; retain baseline
   results before changing matching heuristics. Apply the gates above per book.
4. Use measured gaps and false matches to choose the smallest safety fix, then rerun
   the frozen corpus and physical-device handoff checks.

Tooling is ready for annotation. Human annotations, derived fixtures, full-book
processing, release-gate results, and physical-device evidence remain pending.

## First Alice review: opening-confidence refusal

The first model-assisted batch confirmed four suggested starts (one with a
+200 ms correction) and marked the fifth unsure. Investigation found that the
fifth start pointed into the chapter 12 announcement, before “Here! cried Alice”.
The short clip did not contain the expected passage. These are review results,
not independent onset annotations or a completed corpus gate.

`alice-opening-review.json` freezes the five samples' word evidence, media and
candidate hashes, and saved human responses. The worker previously accepted the
bad start because mean confidence over the whole paragraph was 0.662, despite
weak evidence at its beginning. It now also requires a mean score of at least
0.5 over the first ten matched words (or all words in a shorter passage), with
scores present for every word in that opening. It records this additional score
in `confidence_signals.opening_word_score`. Rejected starts cannot be highlighted. A bounded local recovery pass, described
below, may replace their timestamps only when additional checks pass.

| Reviewed passage | Opening score | Gate result |
| --- | ---: | --- |
| Chapter 1 | 0.771 | Remains aligned |
| Chapter 4 | 0.847 | Remains aligned; human +200 ms correction is still separate |
| Chapter 7 | 0.750 | Remains aligned |
| Chapter 10 | 0.781 | Remains aligned |
| Chapter 12 | 0.431 | Unresolved |

The regression runs the worker's matching/output path against those frozen word
timings. A gate replay over the existing full-book artifact flags 3 of its 732
previously aligned paragraphs: `s000471`, `s000639`, and `s000713`. The first two
additional refusals need human review. This is a targeted confidence safeguard,
not a chapter-introduction detector or evidence that all false starts are fixed.

Validation reused the existing model's word timings; it did not rerun full-book
ASR or alter the published alignment. New worker runs apply the rule. Existing
published alignments require regeneration to gain this safeguard. The broader
corpus and physical-device release gates remain pending.


## Bounded automatic recovery of weak openings

For passages rejected only for weak opening evidence, the worker now retries up
to eight per book. It independently transcribes overlapping 15-second clips
within the first 45 seconds of a local window. It requires the first six text
words to match exactly and refuses repeated occurrences more than one second
apart. No phrase match means the passage stays unresolved.

The worker then realigns the complete paragraph from just before the recognized
opening. It requires complete text, timed words in order, opening and overall
scores of at least 0.5, agreement with the recognized start within 750 ms, and
no overlap with neighboring passages. Decode windows are capped at 120 seconds.
Successful retries record `confidence_signals.opening_recovered`; diagnostics
record candidate, retry, and recovery counts. This is deliberately limited
recovery, not a general repair for missing text or mismatched editions.

A real-media replay of all three rejected Alice passages recovered only
`s000713`: 11,861,123 ms, compared with the model-assisted human confirmation
at 11,861,124 ms. The original start was 11,847,523 ms, in the chapter
announcement. The four accepted review passages remained unchanged;
`s000471` and `s000639` stayed unresolved. The one-millisecond agreement shows
that this retry reproduced the confirmed correction, not one-millisecond
alignment accuracy. The confirmation was model-assisted, not blind ground truth.

This replay reused the existing full-book word timings and ran actual local ASR
and alignment for recovery. It did not rerun full-book transcription, publish a
replacement artifact, or satisfy the broader corpus gates. Regression checks run
with `python3 -m unittest discover -s tools -p '*_test.py'`.


## Review another book on the listening page

The existing local review server can prepare up to twelve explicitly selected
passages from any source-bound candidate. With Expo and the local maintainer
route available, stop any older listening server and run from the repository root:

```sh
python3 tools/listening_practice.py \
  --candidate path/to/alignment.json \
  --epub path/to/book.epub \
  --audio path/to/audio.wav \
  --title "Book title" \
  --segment-ids s000010 s000020 s000030 s000040 s000050
```

Use actual segment IDs from that candidate. Each must be aligned, highlightable,
and longer than 110 characters. The tool verifies the exact media hashes and
EPUB paragraph text. Open `http://localhost:8081/onsets?review=book`, listen,
and choose Perfect or Not sure. Answers use the same separate, source-bound
batch storage as Alice. Keep derived excerpts and their full-source hashes/time
offsets together; excerpt timestamps are relative to the excerpt. These small
model-assisted batches are not independent annotations or full-book coverage.


## Frankenstein opening-letters review result

Five passages from Letters 1 and 2 of John Van Stan’s version 4 narration
were confirmed by the listener, all with zero adjustment to the proposed start.
The batch includes both letter openings and three later paragraphs.

Batch: `f6066a792ec84372403feec15947d4f744e0c9e3d2a41ea3be28cfc41207b9d1`.
The saved responses and source-bound manifest are under
`artifacts/listening-review/<batch-id>/`; excerpt derivation and candidate details
are under `artifacts/listening-review/frankenstein-preparation/`.

This is a successful five-passage model-assisted review on a second book and
narrator. It covers the opening two letters only; it does not establish full-book
accuracy, independent onset accuracy, or a completed beta-exit corpus gate.
