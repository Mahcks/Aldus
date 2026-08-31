# Beta acceptance template

Copy this template into the ignored iOS build artifact directory for each candidate. The tracked
template is a checklist, not evidence that any public build passed.

## Candidate

| Item | Value |
| --- | --- |
| Server release | `<server-version>` |
| Git commit | `<full-commit>` |
| TestFlight build | `<build-number>` |
| iPhone / iOS | `<device-and-version>` |
| Tester / date | `<name-and-date>` |

## Automated gates

| Check | Result | Evidence |
| --- | --- | --- |
| CI | Pending | Workflow URL |
| Release image and demo | Pending | Release URL |
| Standard AMD64 image | Pending | Release workflow |
| Standard ARM64 image | Pending | Release workflow |
| NVIDIA CUDA image | Pending | Release workflow |
| Real KOReader ↔ Web | Pending | CI `koreader-e2e` artifact |

## Physical iPhone acceptance

Use a fresh install or delete Aldus and its local data before the first row. Record **Pass** or **Fail** and a short note; do not infer a pass from automated tests.

Run `make ios-acceptance` on the Mac with an unlocked, trusted iPhone connected. The runner builds
a separate `com.mahcks.aldus.acceptance` app, resets only that app, starts the frozen Alice fixture,
and stores screenshots plus `AldusAcceptance.xcresult` under `artifacts/ios/`. Set `DEVICE=<udid>`
when more than one iPhone is connected. The TestFlight installation and its data are untouched.

The runner covers server setup, EPUB controls, relaunch/reopen, offline download creation, audio
controls, Read/Listen switching, and account/legal controls. A person must still confirm visible
passage accuracy, audible/background/lock-screen behavior, disconnected-server recovery,
cross-account isolation, and the actual TestFlight binary.

| Required flow | Result | Notes |
| --- | --- | --- |
| Add the beta server, bootstrap or sign in, and reopen the app | Pending | |
| Open a fresh EPUB and turn pages in both directions | Pending | |
| Leave the reader, background it, force-quit, and restore the saved passage | Pending | |
| Play, pause, seek, change chapter, and change speed in an audiobook | Pending | |
| Lock the phone and confirm background audio and lock-screen controls | Pending | |
| Switch Read → Listen at a marked passage | Pending | |
| Switch Listen → Read at the same passage | Pending | |
| Repeat Read ↔ Listen quickly; controls debounce and the app does not crash | Pending | |
| Download a title, disconnect the server, and reopen/read/listen offline | Pending | |
| Reconnect and confirm newer progress wins without jumping backward | Pending | |
| Switch accounts or servers and confirm data does not leak between them | Pending | |
| Open account deletion, privacy, support, and diagnostics controls | Pending | |

## Decision

**Status: Pending**

Promote the TestFlight build externally only after every physical row passes. A failed row blocks
promotion; fix it, produce a new build from the new exact commit, and start a new acceptance copy.

## Physical KOReader acceptance

### Automated split gate

GitHub CI runs the `koreader-e2e` job automatically. It downloads the checksum-pinned official
KOReader Linux release onto the disposable runner, then runs Web → KOReader → Web against one
frozen Alice fixture server. Its artifact contains screenshots, logs, and every progress revision.
No KOReader source, build, or cache is stored on the Mac.

Run `make ios-acceptance` separately on the Mac connected to the unlocked iPhone. Together with
`TestExactProgressCrossClientAcceptance`, these checks cover the real Web and KOReader clients, the
real native iPhone reader, and the shared canonical conversion contract. They intentionally do not
claim that CI and the physical iPhone used one live server process; that would require a public
staging service. The physical e-ink checks below still cover screen appearance, device sleep and
network behavior, and HTTPS deployment.

Run this matrix on at least one current KOReader release before advertising KOReader support for a
server release. Download the EPUB from Aldus's OPDS catalog; importing a different copy can produce
a different KOReader document checksum and is not a valid sync test.

| Required flow | Result | Notes |
| --- | --- | --- |
| Add the authenticated Aldus OPDS catalog and search for a title | Pending | |
| Download the EPUB, open it, and turn several pages | Pending | |
| Configure KOReader progress sync with the Aldus reader credential and Binary matching | Pending | |
| Push progress from KOReader, open Aldus, and confirm the same passage | Pending | |
| Move in Aldus, pull in KOReader, and confirm the same passage | Pending | |
| Repeat push/pull on an EPUB without an alignment and confirm native KOReader position sync | Pending | |
| Confirm covers render and the downloaded file keeps its original filename | Pending | |
| Restart KOReader and repeat a pull using both HTTP on a trusted LAN and the documented HTTPS setup | Pending | |
