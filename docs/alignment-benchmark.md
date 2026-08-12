# Forced-alignment benchmark

## Decision

**Keep automatic alignment experimental and continue benchmarking.** WhisperX 3.8.6 is the best candidate tested, but its 329.5 ms median misses the 250 ms target. It has no errors over one second, so it is a useful next baseline, not a production default.

The frozen EPUB, audio, and ten manual anchors were unchanged. All candidates reuse the existing canonical segments and exact DOM-range locators. The original stalign artifacts under `test-fixtures/alice/automatic/` were not regenerated or tuned.

## Comparison

| Candidate | Median | Mean | Max | ≤100 ms | ≤250 ms | ≤500 ms | ≤1,000 ms | >1s | CPU runtime | Peak memory | EPUB restore | Player seek |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| stalign 0.1.57 + whisper.cpp `base.en` | 491 ms | 891.7 ms | 4,602 ms | 4/10 | 4/10 | 5/10 | 7/10 | 3/10 | 810.8 s | 613 MiB | 10/10 | 0 ms |
| WhisperX 3.8.6 `base.en` + CTC | 329.5 ms | 359.7 ms | 767 ms | 1/10 | 4/10 | 8/10 | 10/10 | 0/10 | 165.1 s | ~2.7 GiB | 10/10 | 0 ms |
| MFA `english_mfa` + `english_us_arpa` | 369.5 ms | 405.7 ms | 777 ms | 0/10 | 3/10 | 6/10 | 10/10 | 0/10 | 30.3 s incremental; 195.4 s with coarse pass | ~1.23 GiB | 10/10 | 0 ms |
| WhisperX canonical-window hybrid | 328.5 ms | 362.5 ms | 765 ms | 1/10 | 4/10 | 8/10 | 10/10 | 0/10 | 45.2 s incremental; 210.2 s with coarse pass | ~3.14 GiB | 10/10 | 0 ms |

The memory figures are sampled container peaks, so they are approximate. Runtime excludes first-time image and model downloads. Docker had no NVIDIA runtime; every run used CPU even though the host has an RTX 4070.

## Per-anchor results

| Anchor | Manual | WhisperX | Error | MFA | Error | Hybrid | Error | Restore |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| alice-ch01-01 | 33,745 | 33,428 | 317 | 33,338 | 407 | 33,429 | 316 | yes |
| alice-ch01-02 | 131,458 | 131,241 | 217 | 131,151 | 307 | 131,243 | 215 | yes |
| alice-ch01-03 | 212,388 | 212,185 | 203 | 212,195 | 193 | 212,186 | 202 | yes |
| alice-ch01-04 | 279,459 | 278,692 | 767 | 278,682 | 777 | 278,694 | 765 | yes |
| alice-ch01-05 | 331,956 | 331,614 | 342 | 331,624 | 332 | 331,615 | 341 | yes |
| alice-ch01-06 | 405,317 | 404,921 | 396 | 404,801 | 516 | 404,902 | 415 | yes |
| alice-ch01-07 | 459,112 | 458,641 | 471 | 458,531 | 581 | 458,622 | 490 | yes |
| alice-ch01-08 | 539,352 | 539,305 | 47 | 539,245 | 107 | 539,308 | 44 | yes |
| alice-ch01-09 | 633,279 | 632,657 | 622 | 632,617 | 662 | 632,658 | 621 | yes |
| alice-ch01-10 | 692,257 | 692,472 | 215 | 692,432 | 175 | 692,473 | 216 | yes |

## Candidates

WhisperX was run with CPU `int8`, Silero VAD, `base.en` ASR, and its English CTC alignment model. Raw ASR and forced-alignment outputs are separate. Version 3.8.6 was used because current releases include fixes to CTC word timestamps that materially changed the older 3.7.4 result. It removed the baseline's catastrophic “How brave…” punctuation/segmentation error and all errors over one second.

Montreal Forced Aligner was selected as the dedicated acoustic aligner because it accepts authoritative known text, produces inspectable word-level TextGrids, is locally runnable, maintained, MIT licensed, and fits the existing subprocess boundary. The frozen canonical sentences were cut into one-second-padded windows from the WhisperX coarse pass, then aligned with `english_mfa` and `english_us_arpa`. A whole 14-minute chapter utterance failed to align, and 4 of 85 window utterances remained unresolved. MFA is therefore not independently chapter-localizing in this experiment; its end-to-end cost includes the coarse pass.

The hybrid also uses WhisperX only for coarse localization, supplies canonical EPUB text to CTC, and aligns inside one-second-padded windows. Its result is effectively identical to ordinary WhisperX, so the extra pass adds cost without improving accuracy.

## Error and confidence analysis

The old 4,602 ms punctuation/segmentation failure is gone. Remaining errors are predominantly word-boundary/anchor-onset differences: generated timestamps generally lead manual timestamps by a few hundred milliseconds. Anchor 04 is the largest shared error (765–777 ms), indicating a common boundary or manual-onset interpretation rather than EPUB restoration failure. No skipped/repeated narration or edition mismatch caused a catastrophic error in the corrected runs.

The exposed acoustic/token score is not safe as confidence by itself: high scores can coexist with a wrong boundary. A future confidence decision should require all available signals:

- acoustic/token score and canonical text-match quality;
- no unresolved tokens or alignment at a window edge;
- monotonic local timing without abnormal gaps;
- agreement between coarse ASR and known-text alignment.

High confidence may enable word/sentence highlighting. Medium confidence should fall back to a coarser sentence or chapter position. Low confidence, unresolved alignment, edge clipping, or strong method disagreement should disable highlighting while normal playback continues. This policy is documented only; it is not introduced into product state yet.

## Architecture and artifacts

Go owns cancellation and subprocess lifetime through `server/cmd/alignment-experiment`. The Python worker only converts tool output, prepares audio/text inputs, and evaluates immutable anchors; it does not own application or canonical-position state. The candidate boundary remains replaceable because every tool emits the same `alignment.json` shape consumed by existing validation and browser restoration.

Candidate artifacts are isolated under:

- `automatic/whisperx`: raw ASR, aligned words/characters, candidate mapping, evaluation, runtime, and browser acceptance;
- `automatic/forced-aligner-mfa`: canonical windows, TextGrids, candidate mapping, evaluation, runtime, and browser acceptance;
- `automatic/hybrid-whisperx`: aligned canonical windows, candidate mapping, evaluation, runtime, and browser acceptance.

The real Chromium flow restored all ten exact DOM ranges for every candidate and reported a player API seek difference of 0 ms. That validates serialization, navigation, reverse mapping, and browser/player API behavior; it does not measure audible decoder onset.

## Conclusion

WhisperX materially outperforms the completed stalign baseline and removes catastrophic errors, but it does not meet the median target and only 4/10 anchors are within 250 ms. MFA and the hybrid do not improve it. The canonical sync model remains validated; automatic timestamp generation remains the limiting component. Continue benchmarking boundary semantics/model choices before adopting automatic alignment.

## Timestamp boundary investigation

The follow-up investigation compared each immutable golden timestamp with the WhisperX word interval, first timed CTC character, a fixed waveform-onset detector, MP3 timing metadata, and the browser seek result. Raw measurements are preserved in `automatic/whisperx/boundary-analysis.json` and `automatic/whisperx/media-timeline.json`.

The waveform detector uses one rule for every anchor: the first three consecutive 10 ms frames above -40 dBFS, after the last run of at least 30 ms at or below -50 dBFS, within -100/+200 ms of the CTC word start. It is only an energy-onset diagnostic, not a phoneme recognizer. Connected speech and background noise limit what it can prove.

| Anchor | Opening word | Golden | Word start | Signed error | Word end | Acoustic onset | Preceding silence | Observation |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| alice-ch01-01 | Alice | 33,745 | 33,428 | -317 | 33,708 | 33,348 | 420 ms | golden is 37 ms after word completion |
| alice-ch01-02 | In | 131,458 | 131,241 | -217 | 131,321 | 131,181 | 420 ms | golden is 137 ms after word completion |
| alice-ch01-03 | How | 212,388 | 212,185 | -203 | 212,385 | 212,195 | 470 ms | golden is 3 ms after word completion |
| alice-ch01-04 | Presently | 279,459 | 278,692 | -767 | 279,173 | 278,712 | 500 ms | long opening word plus 286 ms of following silence |
| alice-ch01-05 | There | 331,956 | 331,614 | -342 | 331,754 | 331,644 | 0 ms | connected/noisy lead-in; golden is 202 ms after word completion |
| alice-ch01-06 | Alice | 405,317 | 404,921 | -396 | 405,181 | 404,831 | 390 ms | golden is 136 ms after word completion |
| alice-ch01-07 | Suddenly | 459,112 | 458,641 | -471 | 459,061 | 458,561 | 410 ms | golden is 51 ms after word completion |
| alice-ch01-08 | I | 539,352 | 539,305 | -47 | 539,365 | 539,285 | 450 ms | golden is 13 ms before word completion |
| alice-ch01-09 | However | 633,279 | 632,657 | -622 | 633,037 | 632,677 | 480 ms | golden is 242 ms after word completion |
| alice-ch01-10 | And | 692,257 | 692,472 | +215 | 692,572 | 692,452 | 470 ms | outlier: golden anticipates acoustic/CTC onset |

Nine of ten word starts lead the golden timestamp. The median signed error is **-329.5 ms**. The CTC start differs from the fixed energy onset by only 25 ms median absolute difference (20 ms median signed difference), which supports interpreting the WhisperX value as the beginning of acoustic evidence for the word rather than a delayed recognition point.

The lead is content-dependent rather than a stable transport offset. Its magnitude strongly tracks opening-word duration in this small sample (Pearson `r = 0.85`), while repeated initial letters do not share a fixed error. Anchor 04 is explained specifically: “Presently” occupies 481 ms, and the manual timestamp falls another 286 ms after its CTC end in low-energy audio. Anchor 10 has the opposite sign and rules out a universal correction.

The MP3 reports 1,105 skip samples at 22,050 Hz, or 50.113 ms, through standard skip-sample metadata. That is far smaller than the median lead. WhisperX's CTC starts also agree closely with waveform energy, and Chromium reported exact requested media positions, so neither encoder delay nor browser seeking explains the several-hundred-millisecond difference.

### Defensible boundary variants

| Boundary definition | Median signed | Median absolute | Mean absolute | Max | ≤250 ms | >1s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CTC word start | -329.5 ms | 329.5 ms | 359.7 ms | 767 ms | 4/10 | 0/10 |
| first CTC character end | -289.5 ms | 289.5 ms | 318.3 ms | 727 ms | 3/10 | 0/10 |
| first-word end | -93.5 ms | 136.5 ms | 142.2 ms | 315 ms | 8/10 | 0/10 |
| fixed waveform energy onset | -354.5 ms | 354.5 ms | 382.7 ms | 747 ms | 3/10 | 0/10 |

First-word end is an evidence-based recognition/completion boundary, not an arbitrary offset, and it fits these manual anchors substantially better. It must not replace word start for synchronized highlighting: doing so would deliberately begin the highlight after the spoken word has begun. The improvement instead reveals that most golden timestamps behave like manually perceived first-word completion/recognition points, with variable reaction or seek placement. Anchor 10 demonstrates that even this convention is not universal.

There is therefore no evidence-based universal conversion from acoustic word onset to the existing manual seek timestamps. A word-end transformation predicts this small fixture better, but changes the semantic and still has content-dependent residual error. The recommendation remains: **keep experimental and continue benchmarking**. Before adopting highlighting, establish a separately defined audible-onset measurement protocol while preserving these immutable anchors as the original manual-seek dataset.

## Human audible-onset benchmark

The second fixture, `test-fixtures/alice/onset-anchors.json`, uses a different human-authored semantic: the earliest point at which the opening spoken word audibly begins. It preserves the same ten anchor IDs and frozen media but does not replace the original manual-seek anchors. The resulting evaluation is stored in `automatic/whisperx/onset-evaluation.json`.

| Anchor | Word | Human onset | WhisperX start | Signed error | Absolute | Energy onset | Energy absolute |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| alice-ch01-01 | Alice | 33,195 | 33,428 | +233 | 233 | 33,348 | 153 |
| alice-ch01-02 | In | 131,008 | 131,241 | +233 | 233 | 131,181 | 173 |
| alice-ch01-03 | How | 211,988 | 212,185 | +197 | 197 | 212,195 | 207 |
| alice-ch01-04 | Presently | 278,559 | 278,692 | +133 | 133 | 278,712 | 153 |
| alice-ch01-05 | There | 331,466 | 331,614 | +148 | 148 | 331,644 | 178 |
| alice-ch01-06 | Alice | 404,642 | 404,921 | +279 | 279 | 404,831 | 189 |
| alice-ch01-07 | Suddenly | 458,387 | 458,641 | +254 | 254 | 458,561 | 174 |
| alice-ch01-08 | I | 539,077 | 539,305 | +228 | 228 | 539,285 | 208 |
| alice-ch01-09 | However | 632,454 | 632,657 | +203 | 203 | 632,677 | 223 |
| alice-ch01-10 | And | 692,232 | 692,472 | +240 | 240 | 692,452 | 220 |

| Metric | WhisperX word start | Fixed energy onset diagnostic |
| --- | ---: | ---: |
| Median signed error | +230.5 ms | +183.5 ms |
| Median absolute error | 230.5 ms | 183.5 ms |
| Mean absolute error | 214.8 ms | 187.8 ms |
| Maximum absolute error | 279 ms | 223 ms |
| ≤100 ms | 0/10 | 0/10 |
| ≤250 ms | 8/10 | 10/10 |
| ≤500 ms | 10/10 | 10/10 |
| ≤1,000 ms | 10/10 | 10/10 |
| >1,000 ms | 0/10 | 0/10 |

WhisperX word start meets the MVP viability target against the benchmark whose semantic actually matches synchronized highlighting. The old manual-seek benchmark underestimated suitability because those timestamps mostly landed near first-word completion or a comfortable manually chosen listening position, while WhisperX emits a word-level acoustic alignment boundary.

All ten onset errors have the same positive sign: WhisperX trails the human earliest-audible label by 133–279 ms. The fixed energy detector also trails every label by 153–223 ms. This suggests a systematic difference between a human detecting faint initial evidence and the stable acoustic/CTC evidence used by the diagnostics, not MP3/browser transport delay and not an isolated text-matching failure. No correction offset was applied or fitted.

**Adopt WhisperX 3.8.6 as the MVP automatic-alignment candidate.** Keep candidate artifacts revisioned and retain the original manual fixture for restoration/seek semantics. Before enabling synchronization by default, require exact media hashes and locator restoration, reject unresolved or non-monotonic alignments, suppress highlighting for low text/acoustic confidence or abnormal gaps, and validate on more chapters/books and at least one repeat human-onset annotation pass. The current ten-anchor result supports the bounded Alice MVP; it does not establish broad production accuracy.
