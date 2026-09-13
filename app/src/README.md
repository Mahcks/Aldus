# Frontend code map

Aldus follows Expo Router's screen structure: route files contain the screen
components. Supporting components, hooks, and utilities live outside `app/`,
where Expo will not interpret them as routes.

```text
src/
  app/                         Screens and navigation layouts
    (app)/                     Signed-in screens
      consume/[id].tsx         Reader/player screen composition
    (public)/                  Connect, login, setup, and account claim
    _layout.tsx                Root providers and startup
  components/                  Supporting JSX, grouped by purpose
    ui/                        Buttons, fields, dialogs, states, icons, theme
      tw/                      CSS-enabled React Native primitives
    shell/                     App navigation and page framing
    auth/                      Session providers, gates, and auth framing
    consumption/               Reader and player views and controls
      reader/                  EPUB engines and their locator helpers
    catalog/                   Book covers, shelves, metadata, downloads
    acquisitions/              Request and connection controls
    administration/            Library access controls
    sources/                   Source folders, scans, and import review
  hooks/                       Stateful React logic
    consumption/               Session loading, synchronization, playback, reader tools
    catalog/                   Work files, metadata forms, and artwork actions
    acquisitions/              Request loading and foreground refresh
    administration/            User access, diagnostics, and backups
  lib/                         API, storage, platform I/O, and plain helpers
    consumption/               Work loading, position conversion, reader settings
    catalog/                   Metadata, grouping, completion, resume helpers
    acquisitions/              Request policy and presentation helpers
    activity/                  Reading activity and notification helpers
    administration/            Access and system presentation helpers
    auth/                      Account deletion workflow
    collections/               Collection presentation helpers
    sources/                   Source administration helpers
  generated/                   Generated public API types; never hand-edit
  maintainer/                  Alignment calibration tools
  global.css                   Shared styling tokens
```

## Where a change belongs

- **Screen layout or local UI state:** the route under `app/`.
- **A distinct piece of JSX:** `components/<area>/`. For example,
  `components/consumption/PlayerView.tsx` owns the player layout and drag state.
- **State, effects, and cleanup for a specific behavior:** `hooks/<area>/`.
  `useSleepTimer` owns timer expiry; `useReaderSearch` owns the search workflow.
- **A calculation, mapping, or non-React workflow:** `lib/<area>/`.
- **Shared controls:** `components/ui/`. Navigation-aware page layout belongs in
  `components/shell/Page.tsx`; authentication gates belong in `components/auth/`.

Keep tests and `.native`, `.web`, and fallback implementations together. Preserve
extension-free platform imports so Expo chooses the correct implementation.
Use `./` imports within the same directory and `@/` imports elsewhere. The shared
controls have one public entry point, `@/components/ui`; other groups use direct
file imports.

Do not create a parallel `screens/` tree with route re-export wrappers. Do not put
helpers inside `app/`: Expo treats files there as routes. Group supporting files
by area instead of adding loose files to a catch-all directory.

Extract code around a specific responsibility. A route can own local UI state
and coordinate hooks. Avoid moving every state variable into one giant hook or
introducing global state just to avoid explicit props.

The consume route composes `useConsumptionState`, `useConsumptionLoading`,
`useConsumptionSync`, and `useConsumptionActions`. These coordinate the focused
reader/player hooks, save queues, conflict checks, and read/listen handoff.
Preserve their ordering and the web EPUB reader's mounted lifetime.

The work-management route keeps its tabs and forms in JSX. `useWorkManagement`
owns file and alignment operations; `useWorkMetadata` and `useWorkArtwork` own
the corresponding form state and actions.

## Checks

From the repository root, run `make format`. From `app/`, run `bun run typecheck`,
`bun run lint`, `bun run test`, and `bun run build:web` for a broad frontend change.
Browser tests live in `app/e2e`; run them with `bun run test:e2e` from `app/`.

Native reading, preferences, download, and handoff changes also need the
physical-device checks in the root `AGENTS.md`. A web export or mocked native
test does not replace device validation.

## References

- [Expo Router core concepts](https://docs.expo.dev/router/basics/core-concepts/)
- [Expo's top-level src directory](https://docs.expo.dev/router/reference/src-directory/)
- [React: reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)

Expo defines the route boundary; the product-area subfolders above are Aldus's
convention for keeping supporting code easy to find.
