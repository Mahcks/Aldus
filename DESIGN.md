# Aldus design language

## Approved direction

Personal reading room (concept A, approved September 6, 2026). Everyday reading and listening should feel personal and calm; administration should feel clear and dependable. Use the same palette, controls, navigation conventions, and feedback across both.

The reference composition is a cover beside the current book's title and Continue action on Home, a two-column phone Library, cover and primary actions together on book details, a centered large-cover player, and a desktop account list beside user details. Existing cover artwork is content: never replace it with generated concept art.

## Source of truth

`app/src/global.css` owns semantic tokens. `app/src/features/theme.ts` mirrors colors needed by native props. All permanent UI uses the CSS-enabled primitives in `features/tw`, shared `ui.tsx` components, and Material Community Icons via `AppIcon`.

- Canvas: warm ivory `#faf7f2`; paper `#fffdf8`; controls `#f3ede4`.
- Ink `#27211c`, muted `#6c6258`, subtle `#75695e`. Subtle text must still meet AA.
- Primary accent `#8a3c24`, pressed accent `#6f2f1c`.
- Divider and control boundaries have separate tokens. Control boundaries use `#908171`.
- Desktop navigation uses espresso `#2c241e`, warm readable foregrounds, and a quiet selected background.
- Eight-pixel control corners. Rounded status labels use sentence case; no colored side stripes.

## Type and hierarchy

Keep the installed fonts: Inter for operational text, Lora for book titles and covers, Source Serif 4 for reading passages. The Aldus wordmark is the sole navigation serif exception. Screen titles and section headings use sans. Body copy stays readable; avoid uppercase operational labels and overlong lines.

Primary actions have terracotta fill. Secondary controls have a fine boundary without raised shadows. Quiet actions are unboxed. Do not create rows of equally prominent primary actions.

## Layout and navigation

Phone below 600px; desktop shell at 820px; content at most 1240px. One page header, with back in the header for nested destinations. Keep Home, Library, Discover, Activity, More on mobile. Consumer Library means owned books; Discover means finding/requesting additional content.

Two Library columns by default on phones; the existing compact option uses three. Preserve virtualization, automatic pagination, query/filter state, and scroll restoration. Books opens the organization chooser; Collections is directly reachable. Never add separate series/narrator bottom tabs.

Desktop family administration keeps the account list beside details from 1100px. Smaller screens use list then detail with an explicit back control. Access changes remain immediate and report saving/error state; mockup Save buttons must not imply a nonexistent draft workflow.

## Interactions and states

Short press feedback, native iOS context menus, existing sheet transitions and content fades. Motion must honor reduced motion and never gate an action. Loading uses a compact labeled indicator rather than book-shaped skeletons on every administrative form. Preserve inline errors, retry, account restrictions, download pause/resume, and explicit empty states.

The player's Read along action appears when the current passage supports it; otherwise explain availability once. Reading-position calculation and read/listen handoff semantics are unchanged by this design.

## Verification

Inspect 390px, 1024px, and 1440px layouts, including long titles, empty and populated libraries, account access forms, failure/retry states, and keyboard focus. Browser evidence cannot establish native iPhone readiness; shared chrome and native context menus still need device review.

## Workflow coverage, not just token coverage

Shared colors and controls do not count as a completed workflow redesign. The following distinctions must stay explicit when reporting progress:

| Surface | Current status |
| --- | --- |
| Home, Library grid, book details, player | Direction A compositions implemented; physical-device refinement remains. |
| Library filters | Redesigned as current-value rows with vertical choices and a fixed Done footer; phone bottom sheet, desktop dialog. Shared with individual-library sorting. |
| Family users | List/detail composition plus inline role editing with role descriptions, last-owner protection and explained request permissions implemented. Browser checks cover role changes and dependent controls at all three widths. Creation/settings and credential handoff reviewed at all three widths. |
| Discover requests and release selection | Book preview now uses a phone sheet with fixed request actions and scrollable description. Long descriptions inspected at all three widths. Advanced release selection now uses a phone sheet with readable edition metadata; failed download selection and retry pass at all three widths. |
| Collections and sharing | Create/edit forms have fixed completion footers. Sharing uses a vertical audience chooser and phone sheet; success and failed-save/retry verified at all three widths. Populated lists lead with reading; Arrange mode reveals ordering/removal controls. Collection deletion is reached from Edit. Responsive edit/order and sharing checks pass. |
| Manage work: metadata, artwork, files, sync | Book identity now includes its cover. Core details lead, with publication/series/subjects progressively disclosed. Metadata review has responsive comparisons, compact unchanged rows and a fixed Apply footer. Add file uses a phone sheet. Generated artwork, populated file lists and unsynchronized file-pair selection inspected. Shared radio controls support keyboard selection. Custom artwork and populated failed sync history reviewed at all three widths. |
| Reader preferences | Shared settings reviewed at all widths; tablet reading-flow labels simplified. Settings semantics and exact-progress behavior remain unchanged. Physical iPhone review remains. |
| Account, connection and sign-in | Public screens now share a compact masthead and consistent form column. Setup leads with the library task. Profile/password editing uses fixed-footer phone sheets. Reader connections are progressively disclosed; one-time credential survives viewport changes. Native server switching still needs device review. |
| Sources, acquisitions and system | Source list and import proposals now use flat rows with scan/inspect first and source settings progressively disclosed. Import and folder-setup sheets have fixed completion footers. Acquisition connections are grouped by search and download service. Populated queue, scan history and system workflows reviewed at all three widths. |

Implementation and browser workflow review are complete. Full completion still requires the two physical-device gates below.

## Remaining route and workflow completion gates

These are remaining work, not accepted omissions from the approved direction. Keep each gate open until its layout, realistic states, and responsive screenshots have been reviewed.

- [x] `work/[id]/manage`: metadata comparison and manual details; selected-field updates, conflict/reload, unavailable server and inline publication controls verified at 390/1024/1440.
- [x] `work/[id]/manage`: custom and generated artwork, populated files and failed sync history reviewed. Custom artwork progressively discloses fallback design. File-pair selection and synchronization semantics unchanged.
- [x] `representation/[id]`: edition settings lead; upload history follows; deletion is separate and technical data collapsed. Save and populated layouts verified at 390/1024/1440.
- [x] `search`: advanced release sheet, expanded edition metadata and failed selection/retry inspected at 390/1024/1440; request actions stay visible with long descriptions.
- [x] `acquisitions`: approval, failed-download queue and provider setup inspected at 390/1024/1440. Discover release search and library request rules are covered separately. Approval and import retry checks pass.
- [x] `sources`: source list/settings and import review; request fulfillment rejection/retry and responsive layout verified.
- [x] `sources`: folder selection, populated scan history and entry failures reviewed at 390/1024/1440. Folder navigation derives the source name and keeps Add source visible; file validation/scan semantics unchanged.
- [x] `libraries` and `library/[id]`: creation, members and settings use shared sheets; responsive name validation/layout reviewed. Library rows use available width in Libraries and Account.
- [x] `library/[id]`: request rules use grouped fields and fixed Save footer; missing-source explanation and invalid-size presentation reviewed at 390/1024/1440. Policy enforcement is unchanged.
- [x] `genre-tags`: existing genre editing reviewed at all widths; icon choices open only on request and collapse after selection.
- [x] `system`: diagnostics and recovery layouts reviewed at all widths, including unavailable source folders and failed scans; backup execution remains unchanged.
- [x] `collections` and `collection/[id]`: populated overview and book lists reviewed at all widths; editing, Arrange mode, persisted order and deletion confirmation verified. Sharing rejection/retry also passes.
- [x] `users`: creation, failed creation, one-time credential handoff and account settings reviewed at 390/1024/1440; fixed sheet completion actions.
- [x] `account`: profile/password sheets, reader credentials and remembered-reader sign-in reviewed at 390/1024/1440. Native server switching remains in the device gate below.
- [x] Public `login`, `setup`, `claim`, `demo`: shared entry layout inspected at all widths; setup validation/error and remembered-reader password checks pass.
- [ ] Public native `connect`: device review of server switching and keyboard/safe-area behavior.
- [x] `activity`: active, failed/history, ready and unread updates reviewed at all widths. Phone update actions sit below the text; reader status copy avoids download-service jargon. Recovery controls verified; request mutation semantics unchanged.
- [x] `catalog`: populated series/narrator views and no-match search reviewed at 390/1024/1440. Selected narrator context uses the narrator capability check, including direct detail URLs.
- [x] Reader preferences and surrounding chrome reviewed in the browser at 390/1024/1440. Reading-flow labels no longer break mid-word on tablet. Preference values and exact-position logic unchanged; native validation remains below.
- [x] Final Home, Library, work detail and player compositions compared with concept A at 390/1024/1440. Real content and generated fallback covers remain intact; product actions reflect actual capabilities.
- [ ] Physical iPhone review of shared chrome, sheet keyboard/safe-area behavior and reader controls.

Latest workflow check: 13 browser cases passed (family access/sharing, credential handoff, remembered accounts, Discover description/request visibility), plus 162 client tests, typecheck, lint and web export. Screenshots are under `artifacts/design-redesign/`. These results prove the tested workflows, not the unchecked gates above.

Metadata pass evidence: `app/e2e/metadata-review.e2e.ts` passes at 390, 1024 and 1440px, including conflict/reload and Add file controls. Screenshots in `artifacts/metadata-review/`. Typecheck, lint, format and web export pass. No synchronization or media-finalization logic changed.

Source/acquisition pass evidence: three responsive cases in `app/e2e/acquisition-review.e2e.ts` pass after source settings and import review changes. Includes import rejection/retry and request binding, source settings disclosure, and connection form rendering. Screenshots in `artifacts/design-redesign/` and `artifacts/058/`. Typecheck and lint pass; initial web export passed before the final copy/footer simplification.

Public/account pass evidence: `account-design.e2e.ts` covers setup validation/retry, claim/demo entry, reader-connection disclosure, credential retention across viewport changes and profile editing at 390/1024/1440. Existing family-management cases also pass. Typecheck, lint, format and web export pass. Physical-device connection and keyboard behavior remain unverified.

Secondary administration evidence: six responsive cases in `family-design.e2e.ts` and `secondary-design.e2e.ts` pass. Library members reuse the role editor; adding a member is progressively disclosed. Genre icon selection collapses after choosing. System diagnostics and recovery layouts inspected with failures present. Library creation, policy and settings were verified in the later library administration pass.

Release selection evidence: four `discover.e2e.ts` cases pass, including stale-description protection, responsive edition choices and failed selection/retry. Latest full client suite: 162 tests / 530 assertions; typecheck, lint, format and web export pass. Screenshots: `artifacts/design-redesign/*-discover-releases.png`.

File-management evidence: three `file-design.e2e.ts` cases pass at 390/1024/1440, covering saved edition names, uploaded-file deletion protection and keyboard selection of source files. Typecheck, lint, format and web export pass. No alignment, canonical progress, upload or finalization algorithms changed. Custom artwork and sync job history were verified in the later artwork pass.

Collections evidence: six collection/family cases pass at 390/1024/1440. Three collection cases rerun after overview changes. Typecheck, lint, format and web export pass. Screenshots: `artifacts/design-redesign/*-collection*.png`. Deletion confirmation was checked without removing user data; API deletion semantics are unchanged.

Catalog evidence: three `catalog-design.e2e.ts` cases pass, covering series positions, narrator navigation and empty search results. Typecheck, lint, format and web export pass. Screenshots in `artifacts/design-redesign/`.

Activity evidence: three `activity-design.e2e.ts` cases pass at 390/1024/1440. Five title-status unit tests pass after copy refinement. Typecheck, lint and initial web export pass; final copy export checked separately. Screenshots under `artifacts/design-redesign/*-activity-*.png`.

Library administration pass: creation/settings sheets have fixed completion actions; settings errors stay in the sheet. Empty-name creation is guarded. Library cards became full-width rows so names and access labels remain readable. Three family browser cases cover members, sharing and creation/settings layouts at all widths.

Request-rule layout evidence: three extended family browser cases pass, including fixed policy footer visibility and missing-source disabled state. Typecheck, lint, format and final web export pass.

Acquisition queue evidence: three extended acquisition-review cases pass after populated approval and failed-download coverage. Source inventory now stacks filename/status on phones; scan-history and entry-failure rendering covered, with folder-picker review still pending. Typecheck, lint, format and web export pass.

Source folder completion evidence: three acquisition-review cases pass with folder navigation, selected-folder naming and populated scan failures. Typecheck, lint, format and web export pass. Screenshots: `artifacts/design-redesign/*-source-folder.png`.

Artwork/sync-history evidence: three extended file-design browser cases pass at 390/1024/1440; custom artwork uses a test-only image fixture. Fallback disclosure, failed history, file settings and keyboard source selection verified. Typecheck, lint, format and web export pass.

Final account pass: nine account/family browser cases pass; profile/password dialogs and user creation/credential handoff reviewed at all widths. Typecheck, lint and web export pass. Native connection and keyboard behavior still require the device gate.

Final browser validation (September 6, 2026): 40 responsive workflow cases pass, plus the real-server reader/read-listen/offline-progress/KOReader browser case. The first reader run timed out while the screenshot capture used the same account concurrently; the isolated rerun passed. All 162 client tests (530 assertions), typecheck, lint, formatting, web export and diff whitespace checks pass. Final consumer screenshots: `artifacts/design-redesign/*-final-*.png`.

Device handoff remains open: use the uncommitted main working tree based on `b89396b` with the existing iPhone development build reloaded. Record the iPhone model and installed build. Check Library filters, account/form keyboard behavior, remembered-account/server switching, then a fresh EPUB rendering, reader controls, page navigation, close/reopen restoration, Read → Listen → Read, and a downloaded EPUB reopening with the server unavailable. No native dependency/configuration changes were made by this redesign. Browser checks do not substitute for this device evidence.

Reader opening protection (September 7, 2026): the existing cover remains visible and reader input/accessibility controls are unavailable until media and saved-page restoration finish. Intermediate locations cannot save progress. Native restoration now waits for its destination event rather than goTo dispatch, and timeout leaves a retry state without unlocking the opening page. Web restoration preserves its canonical cursor through automatic layout events until user navigation. Audio seeking/saving requires a loaded media source so an empty player cannot consume a handoff. Canonical coordinate conversion and revision enforcement are unchanged.

Validation: the native adapter regression exercises delayed navigation, suppressed selection/page controls, wrong-resource events, exact target retention, timeout and unmount cancellation. All 163 client tests pass; both real-server reader browser cases pass, including unchanged segment/offset/revision during loading taps at 390/1024/1440. Typecheck, lint, formatting and web export pass. Physical iPhone validation of this opening change is pending; reload the current uncommitted main worktree, test tapping/swiping during restoration, page navigation, reopen, Read → Listen → Read and downloaded reopening offline, and record device/build before calling the native fix verified.
