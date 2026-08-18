# Native EPUB renderer spike

Date: 2026-08-13

## Scope and current state

The Readium adapter is now the production native reader. This document records the adoption evidence and the physical-device checks that still cannot run in Linux/WSL. The web Foliate reader and canonical synchronization model remain unchanged.

The native `EPUBReader.tsx` currently renders a placeholder and returns `null`, an empty string, or `false` from every reader method. `EPUBReader.web.tsx` owns the working Foliate implementation, DOM Range/CFI capture, exact alignment-segment matching, and trusted ReadingCursor behavior. The product consumption route owns Read ↔ Listen orchestration through the existing `/resolve/epub`, `/resolve/audio`, `/locators/epub`, and `/locators/audio` APIs.

Representation state already stores an opaque JSON EPUB locator independently from canonical Work progress. The server's current EPUB canonical resolver understands the frozen alignment's EPUB href plus DOM-element/segment locator. A native renderer therefore needs an adapter into those existing segment locators; its own page percentage cannot become canonical.

Aldus uses Expo SDK 57, React Native 0.86, Hermes, the New Architecture, a locally generated iOS project, a development client, and local Personal Team signing. Before this spike there was no EPUB native bridge.

## Non-negotiable requirements

The renderer must render EPUB2/EPUB3, paginate or scroll, support internal navigation and typography, run acceptably on a physical iPhone, produce a deterministic serializable locator, restore and navigate to that locator, expose text/range context, and support exact fail-closed mapping in both directions. Chapter, page, progression, or percentage alone is insufficient. It must have a credible maintained, legally usable Expo/iOS integration and an Android path.

## Candidate comparison

| Criterion | `react-native-readium` / Readium Mobile | Direct Aldus Readium bridge | `@epubjs-react-native/core` | Controlled Foliate WebView |
| --- | --- | --- | --- | --- |
| EPUB rendering | Native Readium EPUB2/3 | Native Readium EPUB2/3 | epub.js in WebView | Existing Foliate engine in WKWebView |
| Deterministic locator | Readium Locator; wrapper currently exposes href, progression, position, and text | Full Readium Locator can expose the native model | EPUB CFI start/end | Foliate CFI plus Aldus DOM Range |
| Restore/navigation | `initialLocation`, `goTo`, forward/back | Navigator initial locator and `go(to:)` | `initialLocation`, `goToLocation` | Existing `goTo`/CFI after a custom bridge |
| Text/range access | Selection Locator/text; current Locator text must be verified physically | Selection, content service, search, and decoration locators | Selection CFI/text; injected JS can inspect DOM | Full DOM access if Foliate can be packaged reliably |
| Canonical mapping | Promising through text evidence; wrapper omits Readium HTML fragment fields | Strongest, but requires an Aldus Swift/Kotlin bridge | Strong through CFI and DOM injection | Strongest reuse of current web semantics |
| Pagination/styling | Native Readium preferences | Native Readium preferences | epub.js flow/themes | Existing Foliate flow/styles |
| iOS/Android | Swift and Kotlin under one RN API | Separate Swift and Kotlin implementations | One WebView implementation | One WebView concept with platform packaging differences |
| Expo/New Architecture | Development build plus Nitro and Podfile integration; both architectures supported | Local Expo module/native view required | Expo file-system plus `react-native-webview`; JS bridge | Expo DOM/WebView, but Foliate ESM/assets need a new packaging layer |
| Maintenance | Active; RC 17 is policy-eligible, RC 18 published 2026-08-13 | Official Readium toolkits active; Aldus owns bridge maintenance | Last package release 1.4.7, repository activity in 2025 | Foliate active, but this integration would be Aldus-owned |
| License | MIT wrapper; BSD-3-Clause Readium | BSD-3-Clause Readium | MIT | MIT Foliate |
| Main risk | RC API and omitted fragment/range fields | Highest native bridge cost | Older wrapper and large custom WebView surface | Packaging, offline archive loading, touch, and bridge complexity |

Sources: [Readium Swift Toolkit](https://github.com/readium/swift-toolkit), [Readium Navigator guide](https://readium.org/swift-toolkit/3.8.0/documentation/readium/navigator/), [Readium HTML Locator extension](https://readium.org/architecture/models/locators/extensions/html.html), [`react-native-readium`](https://github.com/5-stones/react-native-readium), [`epubjs-react-native`](https://github.com/victorsoares96/epubjs-react-native), [Foliate JS](https://github.com/johnfactotum/foliate-js), and [Expo DOM components](https://docs.expo.dev/guides/dom-components/).

## Narrowing decision

The first spike uses `react-native-readium` 5.0.0-rc.17. It is the only maintained cross-platform React Native candidate already exposing a native Readium view, serializable Locator, current-location callback, selection text/locator, preferences, and imperative navigation. It supports both React Native architectures and keeps an Android path.

RC 18 is pinned and supplies the full-text search used for canonical → native translation. Aldus adds a bounded visible-location bridge so native page positions can map back to exact alignment segments.

The epub.js wrapper is not spiked now because its last release is two years old and it duplicates a substantial reader/context/WebView layer. A custom Foliate WebView would preserve the most web logic but first requires a new secure asset/archive packaging system. A direct Readium bridge remains the fallback if the maintained wrapper loses information Aldus needs.

## Spike A implementation

The isolated authenticated route `/reader-spike`:

1. downloads the exact seeded Alice EPUB through the existing bearer/cookie media API;
2. writes the bytes to the native cache without modifying source media;
3. opens the local file in Readium;
4. provides forward/back controls;
5. records and development-logs every Readium Locator;
6. serializes the locator, tears down the view, and reopens with `initialLocation`;
7. navigates to a known Readium publication position;
8. captures an explicit selection Locator and text through a custom selection action;
9. maps unique normalized text context to an existing highlightable Alice alignment segment;
10. passes that unchanged segment locator through Aldus's existing EPUB → canonical resolver;
11. fails closed on malformed locators, missing text evidence, ambiguity, or resolver failure.

The spike deliberately sets canonical offset zero after matching a segment. Exact within-segment native offset is not claimed and belongs to the next proof if the renderer survives physical validation.

Automated checks cover locator validation/serialization, unique text mapping, ambiguous mapping failure, and idempotent Expo Podfile configuration. The production `EPUBReader` and all web synchronization code remain untouched.

## Dependency and build impact

- Added: `react-native-readium@5.0.0-rc.17`, `react-native-nitro-modules`, and Expo-compatible `expo-file-system`.
- CocoaPods: Readium's custom specs source, `ReadiumGCDWebServer`, and modular-header `Minizip`, plus the upstream Minizip post-install workaround.
- Expo: one local config plugin applies those required Podfile changes during prebuild.
- A native development-client rebuild is mandatory.
- No personal signing values are stored. The dependencies do not require capabilities incompatible with Personal Team signing.
- Android remains viable through the wrapper's Readium Kotlin implementation, but was not built in this iPhone-first spike.

## Physical iPhone procedure

The Linux/WSL environment cannot execute Xcode or touch the iPhone, so physical acceptance is intentionally pending.

On the Mac checkout:

```sh
git pull
cd app
bun install
bunx expo prebuild --platform ios
cd ios
pod install --repo-update
cd ../..
make ios-dev
```

On the WSL development host:

```sh
make dev-server
EXPO_PUBLIC_API_URL=http://192.168.86.28:8080 make expo-dev
```

Sign in on the iPhone, then open `aldus://reader-spike`. Verify Alice Chapter 1 renders, forward/back respond, a saved location survives **Reopen saved**, **Go to known position** moves, and selecting a complete aligned passage followed by **Capture for sync** produces a canonical segment in the diagnostics.

Record initial open time, page-turn feel, repeat-open stability, restore accuracy, locator JSON, selection text/context, and memory or crash symptoms. Do not claim adoption without that evidence.

## Current evidence and remaining risks

- TypeScript, lint, tests, Expo Doctor, iOS Hermes export, web export, and generated Podfile shape pass.
- No physical-device renderer result exists yet.
- The wrapper's JavaScript Locator omits Readium HTML `fragments`/range fields and exposes progression plus optional text. Physical evidence must show whether selection and current-location text are sufficient.
- Automated coverage verifies exact within-segment mapping, fail-closed canonical restoration, forward and backward commits, and transitional-location handling. Physical confirmation on the installed iPhone remains required.
- Performance and repeated lifecycle behavior remain physical-device checks.

## Conclusion

`Run the physical production-reader acceptance checklist`

Rebuild the native development client, then exercise the production Work reader rather than the old isolated spike: page both directions, switch editions, read → listen → read, background and force-quit, reopen offline, and confirm the saved location. Any mismatch must fail visibly rather than falling back to percentage-based synchronization.
