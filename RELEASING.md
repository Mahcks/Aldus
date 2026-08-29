# Releasing Aldus

Start every release decision with the read-only status command:

```sh
make release-status VERSION=<server-version>
```

It compares the latest release tag with `HEAD`, identifies the affected publication surfaces,
checks the public server-version pins, and prints the next command. It does not modify anything.

## Candidate record

Copy this block into the release notes or working issue and complete it before publishing:

```text
Candidate commit:
Server version:
Changed surfaces: container/demo | iOS | docs
Supported clients: current App Store build; non-expired TestFlight builds still assigned to groups
API decision: no change | additive v1 | targeted optional capability | new API major
Oldest supported iOS build tested against candidate server:
New iOS build tested against previous server, or optional feature gate/message:
Database migration:
Backup:
Upgrade:
Restore:
```

## Compatibility gate

`/api` and `/api/v1` are v1. Version 1 is additions-only while a released client depends on it.
Adding a route or optional response field is compatible. Removing or renaming a route or field,
changing a field's type or meaning, or changing authentication or status behavior is breaking.
A breaking change requires `/api/v2` while v1 remains available; there is no override that makes a
breaking v1 change safe.

For an optional feature that needs a newer server, keep the rest of the client usable against the
previous server and show a specific server-update message only for that feature.

Before releasing a candidate server:

- List the current App Store build and every non-expired TestFlight build still assigned to a
  tester group.
- Exercise the oldest supported iOS build against the candidate server.
- If shipping iOS too, exercise the new build against the previous server or verify its targeted
  capability gate.
- When `release-status` flags API paths, classify the diff as no change, additive v1, targeted
  optional capability, or new API major before continuing.

## Which command to use

| Change | Publication | Command |
| --- | --- | --- |
| Server, Docker, alignment, shared/web app | Container, demo, and tag-matched docs | `make release VERSION=<server-version>` |
| Native or shared app | Internal iOS candidate, after its referenced server release is public | `make ios-testflight` |
| Both | Container/demo first, then iOS | Run the two commands above in order |
| Docs only | Documentation | Manually dispatch the **Docs** workflow |
| Existing demo tag needs redeployment | Demo recovery only | `make demo-deploy VERSION=<existing-server-version>` |

The two product phases are resumable, not atomic. `demo-deploy` redeploys an immutable image tag;
it does not roll back a migrated database. A database rollback requires the matching backup and
the previous image and Compose files.

The container workflow creates the public GitHub Release automatically. Its notes categorize the
commits, link the exact standard and CUDA images with their verified digests, attach the matching
Compose files, and link the demo, documentation, and full source comparison. Do not create or copy
release notes manually.

Common release order:

- Additive server feature: release server/web first; iOS may adopt it later with fallback behavior.
- Native-only fix using unchanged v1: release iOS only.
- Breaking contract proposal: stop, add v2 with dual support, release the server, then release iOS.
- Shared UI change using unchanged v1: release container/demo and iOS independently.

## Prepare and verify

If status reports mismatched public pins:

```sh
make release-prepare VERSION=<server-version>
```

This updates only the approved server-version files. It never changes the iOS marketing version.
Review and commit the result, push it, wait for that exact commit's CI, then rerun
`make release-status`.

Before the container phase, record the result of:

```sh
make generate-check
make lint
make test
make build
git diff --check
```

Also create and download a verified database backup, test the upgrade and restore procedure, and
record the result in the candidate record.

## Phase checklist

- [ ] Candidate commit and server version recorded
- [ ] Changed surfaces classified by `make release-status`
- [ ] Supported-client and API compatibility gate completed
- [ ] Database migration, backup, upgrade, and restore checked
- [ ] Container release completed: `make release VERSION=<server-version>`
- [ ] Demo reports ready on the same immutable tag
- [ ] Tag-matched Docs workflow completed as the final server-release phase
- [ ] Internal iOS build completed when required: `make ios-testflight`
- [ ] A copy of `docs/product-mvp-acceptance.md` completed on a physical iPhone
- [ ] External TestFlight promotion completed: `make ios-external BUILD_ID=<processed-build-id>`

If a phase stops, do not restart completed phases blindly. Rerun `make release-status`, then resume
with the exact command for the incomplete phase:

```sh
make demo-deploy VERSION=<existing-server-version>
./scripts/release.sh docs <existing-server-version>
make ios-testflight
make ios-external BUILD_ID=<processed-build-id>
```

Final App Store submission remains a manual App Store Connect action.
