# Beta acceptance record

This is the release gate for the current Aldus server and iOS candidate. A candidate is not accepted until every required row below passes on a physical iPhone against the exact server image recorded here.

## Candidate

| Item | Value |
| --- | --- |
| Server release | `0.1.0-beta.16` |
| Git commit | Pending |
| TestFlight build | Pending |
| iPhone / iOS | Pending |
| Tester / date | Pending |

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

**Status: NOT ACCEPTED**

Promote the TestFlight build externally only after every physical row passes. A failed row blocks promotion; fix it, produce a new build from the new exact commit, and replace the candidate details above.
