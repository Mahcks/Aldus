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
