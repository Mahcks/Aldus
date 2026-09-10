# Local dependency patches

The Readium patch includes the visible-location bridge and iOS `restoreTo`, which confirms the saved anchor is visible before the app unlocks the reader. The matching Readium toolkit probe is installed by `plugins/readium-restore.cjs` during CocoaPods installation. Both parts require rebuilding the native client.

Regenerate the Nitro bridge with Nitrogen **0.36.5**, matching the installed Nitro runtime. Preserve the existing patch when updating it. Bun 1.3.5 cannot reliably apply a newly added file inside the generated Swift directory in a fresh install: append the generated `Func_void_bool.swift` contents unchanged to the existing `Func_void_SearchPage.swift`, then omit the standalone file from the patch. This is packaging of generated output, not a handwritten replacement for the generated class.

After updating the patch, verify a fresh install with an empty Bun cache as well as type checking. Generated code and a passing web test do not establish that the iOS reader works; rebuild and test on a physical device.

## Verify reader restoration on an iPhone

After committing and pushing the changes, run these commands in the Aldus checkout on the Mac connected to the iPhone:

```sh
git pull --ff-only
cd app
bun install
bun run ios:device
bun run start:dev-client
```

Open **Aldus Dev**. Record `git rev-parse HEAD`, the app build, iPhone model, and iOS version alongside the results. Metro reload alone does not update the Readium bridge.

1. Open a fresh EPUB. Confirm text renders, reader controls appear, and page navigation works.
2. Select a distinctive sentence well past the opening pages and save the place. Wait for confirmation. Close and reopen; that sentence must be visible before restoration is announced.
3. Turn a page and immediately switch to listening or close. Reopen and verify the latest place. Repeat with a book that has no paired audiobook.
4. For a downloaded book, enable airplane mode, move and save a new place, close, and reopen. Reconnect and reopen again; it must retain that place.
5. With an aligned pair, verify Read → Listen → Read returns to the same passage.
6. Change the place on another device while this phone has an offline update. Reconnect; a conflict must keep both choices available rather than silently overwrite either one.
7. Select across a page boundary, save, and reopen. Also test changing font size before reopening: compare the sentence, not the page number.

A missing or ambiguous anchor must show a restore error and retain the stored position. An old position already overwritten before this fix is not recovered by these checks. Do not mark device validation complete until these checks have actually run.
