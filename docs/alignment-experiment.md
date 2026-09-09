# Alice Chapter 1 alignment experiment

## Decision

The candidate uses [stalign 0.1.57](https://storyteller-platform.dev/blog/20260305_stalign/) with its local whisper.cpp backend, the `base.en` model, sentence granularity, one processor, and eight CPU threads. stalign was selected because its maintained pipeline is specifically designed to align ebook text with audiobook narration and tolerate missing chapters and spoken/textual differences. Aldus keeps stalign's output as a candidate; `test-fixtures/alice/anchors.json` remains the immutable truth.

The alternatives considered were:

| Tool | Installation and hardware | Known-text and timestamp behavior | Tradeoff |
| --- | --- | --- | --- |
| stalign | Node 24 or standalone binary, ffmpeg, local whisper.cpp; CPU and several GPU builds | Aligns ebook text to ASR output; sentence or word media overlays; handles chapter/narration differences | Best experiment fit and MIT licensed, but packaged Linux binaries require a recent glibc and its CLI can exit zero after a worker failure |
| [WhisperX](https://github.com/m-bain/whisperX) | Python, PyTorch, faster-whisper, VAD and language-specific wav2vec2 models; GPU preferred, CPU int8 supported | Word timestamps are refined with forced phoneme alignment; unalignable characters may have no timestamp | Strong next benchmark for timing, but a heavier worker and it aligns the ASR transcript rather than the authoritative EPUB directly |
| [OpenAI Whisper](https://github.com/openai/whisper/blob/main/whisper/transcribe.py) | Python/PyTorch or whisper.cpp; CPU/GPU | Native word timestamps are inferred from model attention and can change transcription behavior | Simple transcription baseline, not a known-text forced aligner; stalign already exercises its whisper.cpp form |
| [Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/en/v3.3.2/installation.html) | Conda/Docker plus Kaldi, pronunciation dictionary, acoustic model, and corpus preparation | Mature phone/word forced alignment against known transcripts | Deterministic-looking corpus workflow and maintained models, but highest preparation/installation cost for a single audiobook chapter |

Whisper/WhisperX code is MIT licensed, stalign is MIT licensed, and Montreal Forced Aligner is MIT licensed. Model licenses remain separate deployment inputs and must be recorded when models change.

## Boundary and formats

The Go-owned experiment entry point is `server/cmd/alignment-experiment`; it propagates cancellation and invokes the narrow `tools/alignment.py` worker subprocess. No Python code knows about SQLite, HTTP, progress state, KOReader, or clients.

```text
Go experiment command
  -> stalign: frozen EPUB + MP3 -> transcription JSON + aligned EPUB
  -> alignment.py convert -> Aldus candidate alignment.json
  -> validate hashes, monotonic ranges, and locator fields
  -> alignment.py evaluate -> evaluation.json
```

`transcription.json` retains the raw transcript and a timeline of `{text,startTime,endTime,confidence}` words. `alignment.json` contains ordered source text, original EPUB DOM range boundaries, audio bounds, confidence, and word timings. The candidate does not use percentages and does not become `ready` alignment state automatically.

EPUB reverse mapping is preserved by normalizing whitespace while retaining a character-by-character map to each original XHTML text node and offset. Every stalign sentence is found monotonically in that mapped stream. Segment boundaries are then serialized as the original resource href plus start/end DOM paths and text-node offsets. These ranges restore without requiring the spans stalign injects into its output EPUB. Renderer CFIs are left null because stalign does not emit CFIs for the original unmodified EPUB.

## Results

| Anchor | Manual ms | Generated ms | Error ms | Exact passage | Confidence |
| --- | ---: | ---: | ---: | :---: | ---: |
| alice-ch01-01 | 33,745 | 33,700 | 45 | yes | 0.9134 |
| alice-ch01-02 | 131,458 | 131,490 | 32 | yes | 0.9213 |
| alice-ch01-03 | 212,388 | 216,990 | 4,602 | yes | 0.8567 |
| alice-ch01-04 | 279,459 | 278,860 | 599 | yes | 0.7872 |
| alice-ch01-05 | 331,956 | 330,650 | 1,306 | yes | 0.9705 |
| alice-ch01-06 | 405,317 | 404,640 | 677 | yes | 0.9299 |
| alice-ch01-07 | 459,112 | 459,040 | 72 | yes | 0.9270 |
| alice-ch01-08 | 539,352 | 539,310 | 42 | yes | 0.9352 |
| alice-ch01-09 | 633,279 | 632,120 | 1,159 | yes | 0.9369 |
| alice-ch01-10 | 692,257 | 692,640 | 383 | yes | 0.9450 |

- Median absolute error: **491 ms**
- Mean absolute error: **891.7 ms**
- Maximum error: **4,602 ms**
- At or below 250 ms: **4/10**
- At or below 500 ms: **5/10**
- At or below 1,000 ms: **7/10**
- Over 1,000 ms: **3/10**
- Exact passage restoration: **10/10**

The candidate fails the exact-sync timing criterion. `alice-ch01-03` is catastrophic: Whisper merged punctuation around “after such a fall as this” and placed “How brave…” at 216,990 ms instead of its manually observed 212,388 ms. `alice-ch01-05` and `alice-ch01-09` also exceed one second. Word-granularity stalign output retained the same timestamps, isolating the failures to transcription/timestamp extraction rather than EPUB normalization, canonical conversion, or sentence-only media-overlay generation.

## Runtime and determinism

The measured machine was an AMD Ryzen 9 7900X (12 cores/24 threads), WSL2, Docker on CPU, with `base.en`, eight threads, and one transcription processor. The host RTX 4070 was visible to WSL but Docker had no NVIDIA runtime, so it was not used.

- Audio preprocessing: 0.15 seconds
- Transcription: 809.3 seconds; 613 MB peak resident memory
- Sentence alignment: 1.02 seconds; 350 MB peak resident memory
- Conversion/evaluation: under 0.3 seconds
- Approximate processing total excluding first-time downloads/container setup: 810.8 seconds

`runtime.json` records both transcription runs and their artifact comparison. The output is considered deterministic only if the raw JSON hashes match; alignment JSON is regenerated and compared separately.

Both transcription runs produced SHA-256 `c0f0f46a54b1edba326aa40a75e497a15cc3b8d9d5a21ca9a3db08275ccf9e29`. Independently converted candidate files also matched byte-for-byte at SHA-256 `127cc4ca10d1d1f4a88e80ba3cad6c9ad89ac97bd46fbd60342f9b515e8e7024`.

The real Chromium acceptance run restored the original DOM range exactly for all 10 anchors, sought the frozen MP3 to each candidate timestamp, and reported a player API seek difference of 0 ms for each. `acceptance.json` preserves the results. This proves the candidate can drive the existing browser flow, but it does not erase the candidate-to-golden timing errors above.

## Conclusion

Automatic alignment is **not good enough to proceed as the production default**. Text matching and exact EPUB restoration are sound, but only half the anchors are within 500 ms and three exceed one second. The next bounded experiment should benchmark WhisperX (or another true acoustic forced aligner) against the same frozen chapter before committing. The canonical model should not change: the observed failures are timestamp extraction failures.


## Development worker diagnostics and GPU qualification

These notes describe the development candidate, not a published release.

### Worker diagnostics

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

### NVIDIA acceleration

Use an NVIDIA alignment image and give its container GPU access. Aldus selects a
supported compute precision automatically and uses a smaller batch on GPUs with
4 GB of memory or less. Normal setup does not require precision or batch flags.
The existing batch-size override is for advanced tuning only.

The standard CUDA image uses CUDA 12.8. A CUDA 12.6 candidate is available to build
for older NVIDIA cards such as the GTX 1050 Ti; it is not a published release tag. A reported GTX 1050 Ti test completed a full
Catching Fire audiobook, but server validation and manual timing checks remain
separate release checks. Build it from the
repository with `make docker-cuda-legacy`. This reuses the same worker and models.

On the GPU host, with the candidate image and repository available, run:

```sh
make alignment-gpu-check IMAGE=aldus:cuda-legacy
```

This processes 90 seconds of the pinned public-domain Alice narration using both
transcription and word alignment. It mounts no library data, exposes no ports, and
runs with networking disabled. A successful check is a first hardware check, not
proof that a full audiobook fits memory or completes within the configured timeout.
Test a full book before changing a production deployment. Docker still needs the
NVIDIA Container Toolkit and compatible host drivers; the app cannot configure
host GPU access from inside its container.

### Checkpoint binding

Completed transcription and word-timing checkpoints are bound to the source
hashes, extracted ebook text, model, worker code, dependency versions, and compute
settings. Changes invalidate reuse. Recovery repeats an interrupted stage from
its beginning; it does not resume within transcription or a chapter. Switching
CPU/GPU settings also invalidates existing checkpoints. Final server validation
is required even when checkpoints are reused. Older released workers may not
have saved checkpoints.
