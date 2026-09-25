// Run in a separate Bun process: React/native bridge mocks must not leak into other tests.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

(globalThis as any).__DEV__ = false;
let searchRelease: (value: unknown) => void = () => {};
let restoreRelease: (value: boolean) => void = () => {};
let restoreLocator: any;
let steps = 0;
let visible: any;
let decorations: any[] = [];
let saveFeedback: 'saved' | 'offline' | undefined;
const feedbackTimers = new Map<object, () => void>();
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = ((callback: () => void, delay: number) => {
  if (delay !== 4000 && delay !== 3500) return nativeSetTimeout(callback, delay);
  const timer = {};
  feedbackTimers.set(timer, callback);
  return timer;
}) as any;
globalThis.clearTimeout = ((timer: any) => {
  if (!feedbackTimers.delete(timer)) nativeClearTimeout(timer);
}) as any;
function tickFeedback() {
  const [timer, callback] = feedbackTimers.entries().next().value!;
  feedbackTimers.delete(timer);
  callback();
}
const bridge = {
  goTo: (_locator: unknown) => {},
  restoreTo: (locator: unknown) => {
    restoreLocator = locator;
    return new Promise<boolean>((resolve) => {
      restoreRelease = resolve;
    });
  },
  goForward: () => steps++,
  goBackward: () => steps++,
  search: () =>
    new Promise((resolve) => {
      searchRelease = resolve;
    }),
  loadMoreSearchResults: async () => ({ results: [], hasMore: false }),
  cancelSearch: () => {},
  currentVisibleLocation: async () => visible,
};
let refIndex = 0;
let stateIndex = 0;
const effects: (() => () => void)[] = [];
mock.module('react', () => ({
  forwardRef: (render: unknown) => render,
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: refIndex++ === 0 ? bridge : value }),
  useState: (value: unknown) => {
    const index = stateIndex++;
    return [
      index === 0 ? 'file:///book.epub' : value,
      (next: any) => {
        if (index === 1) decorations = next;
        if (index === 2) saveFeedback = next;
      },
    ];
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => () => void) => effects.push(effect),
  useImperativeHandle: (ref: any, factory: () => unknown) => {
    ref.current = factory();
  },
  // Not indexed like useState above: theme-preference's store reads a plain
  // snapshot rather than tracking its own hook-call position.
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
const jsx = (type: unknown, props: unknown) => ({ type, props });
mock.module('react/jsx-runtime', () => ({ jsx, jsxs: jsx }));
mock.module('react/jsx-dev-runtime', () => ({ jsxDEV: jsx }));
mock.module('react-native', () => ({
  ActivityIndicator: 'Spinner',
  Platform: { OS: 'ios' },
  Appearance: {
    getColorScheme: () => 'light',
    addChangeListener: () => ({ remove() {} }),
  },
}));
mock.module('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
mock.module('react-native-readium', () => ({ ReadiumView: 'ReadiumView' }));
mock.module('expo-file-system', () => ({ File: class {}, Paths: {} }));
mock.module('../../src/components/ui/tw', () => ({ Text: 'Text', View: 'View' }));
mock.module('../../src/components/ui/index', () => ({ IconButton: 'IconButton' }));
mock.module('../../src/components/consumption/reader-save-feedback', () => ({
  ReaderSaveFeedback: 'ReaderSaveFeedback',
}));

const { EPUBReader } = await import('../../src/components/consumption/reader/EPUBReader.native');
const events: any[] = [];
const ref: any = {};
const target = {
  href: 'chapter.xhtml',
  locator: { type: 'dom-element', dom_path: 'p[1]' },
  offset: 7,
};
const tree = (EPUBReader as any)(
  {
    source: 'file:///book.epub',
    segments: [
      {
        id: 'segment',
        highlightable: true,
        epub_href: target.href,
        epub_locator: target.locator,
        text: 'Alice waited patiently for the caterpillar to speak again.',
      },
    ],
    onLocation: (location: unknown) => events.push(location),
  },
  ref,
);
function find(node: any, type: string): any {
  if (node?.type === type) return node.props;
  for (const child of [node?.props?.children].flat()) {
    const result = child && find(child, type);
    if (result) return result;
  }
}
const native = find(tree, 'ReadiumView');
const previous = find(tree, 'IconButton');
const cleanup = effects[0]();
await Promise.resolve();
const destination = {
  href: target.href,
  type: 'application/xhtml+xml',
  locations: { progression: 0.5 },
};
let settled = false;
const restoring = ref.current.restoreLocation(target).then((value: boolean) => {
  settled = true;
  return value;
});
await native.onLocationChange({ ...destination, href: 'cover.xhtml' });
previous.onPress();
native.onSelectionAction({ locator: destination, selectedText: 'Alice', actionId: 'listen-here' });
assert.equal(events.length, 0, 'Search-time locations/selections must not publish progress');
assert.equal(steps, 0, 'Page controls must not cancel an active restore');
searchRelease({ isSupported: true, results: [{ locator: destination }], hasMore: false });
await Promise.resolve();
await Promise.resolve();
assert.equal(settled, false, 'goTo dispatch is not restore completion');
await native.onLocationChange({ ...destination, href: 'cover.xhtml' });
assert.equal(settled, false, 'An opening-page event cannot unlock the reader');
visible = { ...destination, locations: { progression: 0.01 } };
await native.onLocationChange(visible);
assert.equal(settled, false, 'Page 2 in the correct chapter is not proof of restoration');
assert.equal(events.length, 0, 'An early same-chapter event must not publish progress');
visible = destination;
restoreRelease(true);
assert.equal(await restoring, true);
assert.equal(events.length, 1);
assert.equal(events[0].reason, 'restore');
assert.deepEqual(events[0].sync, target, 'Keep the exact canonical target, not page percentage');

settled = false;
const saved = ref.current
  .restoreLocation({ cfi: JSON.stringify(destination) })
  .then((value: boolean) => {
    settled = true;
    return value;
  });
await Promise.resolve();
assert.equal(settled, false, 'Unaligned saved locators also await navigation');
await native.onLocationChange(destination);
assert.equal(settled, false, 'Even an identical location event needs native anchor verification');
restoreRelease(true);
assert.equal(await saved, true);
assert.equal(events.at(-1).reason, 'restore');

assert.ok(native.selectionActions.some((action: any) => action.id === 'save-place'));
const chosen = {
  ...destination,
  text: { highlight: 'waited patiently', before: 'Alice ', after: ' for the caterpillar' },
};
native.onSelectionAction({
  locator: chosen,
  selectedText: 'waited patiently',
  actionId: 'save-place',
});
assert.equal(events.at(-1).reason, 'explicit');
assert.deepEqual(
  JSON.parse(events.at(-1).cfi),
  chosen,
  'Save the selected text, not the page start',
);
assert.equal(saveFeedback, undefined, 'Selection alone must not claim the save succeeded');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(destination) }, 'saved');
assert.equal(saveFeedback, undefined, 'A stale save must not confirm a different selection');
assert.equal(decorations.length, 0, 'A stale save must not highlight a different selection');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, 'saved');
assert.deepEqual(
  decorations[0].decorations[0].locator,
  chosen,
  'Saving immediately highlights the exact saved sentence',
);
tickFeedback();
assert.equal(saveFeedback, undefined, 'The save confirmation is temporary');
assert.equal(decorations.length, 0, 'The save highlight expires with its confirmation');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'offline');
assert.equal(saveFeedback, 'offline', 'Offline confirmation distinguishes a local save');
assert.deepEqual(
  decorations[0].decorations[0].locator,
  chosen,
  'A durable offline save also highlights the sentence',
);
tickFeedback();
assert.equal(saveFeedback, undefined);

ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
const secondChosen = {
  ...destination,
  text: { highlight: 'caterpillar', before: 'for the ', after: ' to speak again' },
};
native.onSelectionAction({
  locator: secondChosen,
  selectedText: 'caterpillar',
  actionId: 'save-place',
});
assert.equal(saveFeedback, undefined, 'A new selection clears the earlier success message');
assert.equal(decorations.length, 0, 'A new selection clears the earlier saved highlight');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, undefined, 'The previous selection cannot confirm a newer save');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(secondChosen) }, 'offline');
assert.equal(saveFeedback, 'offline');

const countAfterSelection = events.length;
await native.onLocationChange(destination);
assert.equal(
  events.length,
  countAfterSelection,
  'Closing the menu must not replace the saved sentence',
);
await native.onLocationChange({ ...destination, locations: { progression: 0.6 } });
assert.equal(
  events.length,
  countAfterSelection + 1,
  'Reading the next page resumes normal tracking',
);
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(
  saveFeedback,
  undefined,
  'A late save after leaving the page must not show confirmation',
);

const restoreChosen = ref.current.restoreLocation({ cfi: JSON.stringify(chosen) });
await native.onLocationChange(destination);
restoreRelease(true);
assert.equal(await restoreChosen, true);
assert.deepEqual(JSON.parse(events.at(-1).cfi), chosen, 'Reopening must retain the saved sentence');
assert.equal(decorations.length, 0, 'The cue must not expire behind the opening cover');
assert.equal(feedbackTimers.size, 0, 'Hidden restoration must not start the cue timer');
ref.current.revealRestoredPlace();
assert.deepEqual(
  decorations[0].decorations[0].locator,
  chosen,
  'Reopening highlights the saved sentence',
);
ref.current.revealRestoredPlace();
assert.equal(feedbackTimers.size, 1, 'Repeated readiness must not restart the cue');
assert.equal(feedbackTimers.size, 1);
tickFeedback();
assert.equal(decorations.length, 0, 'The restore highlight is temporary');

const countAfterReopen = events.length;
await native.onLocationChange(destination);
assert.equal(
  events.length,
  countAfterReopen,
  'A restored sentence must survive a repeated page event',
);

for (const actionId of ['save-place', 'listen-here']) {
  previous.onPress();
  const unalignedPage = { ...destination, locations: { progression: 0.4 } };
  visible = unalignedPage;
  await native.onLocationChange(unalignedPage);
  assert.equal(events.at(-1).sync, undefined);

  const selection = { ...unalignedPage, text: chosen.text };
  native.onSelectionAction({ locator: selection, selectedText: 'waited patiently', actionId });
  const countAfterPageSelection: number = events.length;
  await native.onLocationChange(unalignedPage);
  assert.equal(
    events.length,
    countAfterPageSelection,
    `${actionId}: an earlier unaligned page turn must not replace the selected sentence`,
  );
}

const beforeFailedRestore = events.length;
const failedRestore = ref.current.restoreLocation(destination);
await native.onLocationChange(destination);
restoreRelease(false);
assert.equal(await failedRestore, false, 'An invisible or missing anchor must fail restoration');
assert.equal(events.length, beforeFailedRestore);

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let expire: () => void = () => {};
globalThis.setTimeout = ((callback: () => void) => {
  expire = callback;
  return 1;
}) as any;
globalThis.clearTimeout = realClearTimeout;
const expired = ref.current.restoreLocation(destination);
expire();
assert.equal(await expired, false, 'A missing destination event must fail instead of unlocking');
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

native.onSelectionAction({
  locator: chosen,
  selectedText: 'waited patiently',
  actionId: 'save-place',
});
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, 'saved');
assert.equal(feedbackTimers.size, 1);
previous.onPress();
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, undefined, 'Turning the page blocks late confirmation before arrival');

native.onSelectionAction({
  locator: chosen,
  selectedText: 'waited patiently',
  actionId: 'save-place',
});
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(feedbackTimers.size, 1);
const canceled = ref.current.restoreLocation(destination);
cleanup();
assert.equal(feedbackTimers.size, 0, 'Unmount cancels feedback timers');
assert.equal(await canceled, false, 'Unmount cancels navigation without reporting success');

// A web-saved CFI must restore even when the EPUB has no audiobook alignment.
refIndex = 0;
stateIndex = 0;
const cfiEvents: any[] = [];
const cfiRef: any = {};
const effectIndex = effects.length;
const cfiTree = (EPUBReader as any)(
  {
    source: 'file:///unaligned.epub',
    segments: [],
    onLocation: (location: unknown) => cfiEvents.push(location),
  },
  cfiRef,
);
const cfiNative = find(cfiTree, 'ReadiumView');
const cleanupCFI = effects[effectIndex]();
await Promise.resolve();
for (const savedCFI of [
  { href: 'titlepage.xhtml', cfi: 'epubcfi(/6/2!/4/2,,/2)' },
  {
    href: 'Suzanne Collins - Hunger Games 2 - Catching Fire_split_1.html',
    cfi: 'epubcfi(/6/6!/4,/108/2/1:448,/128/2/1:342)',
  },
]) {
  const count = cfiEvents.length;
  const attempt = cfiRef.current.restoreLocation(savedCFI);
  assert.equal(restoreLocator.href, `${savedCFI.href}#${savedCFI.cfi}`);
  visible = { ...destination, href: `${encodeURI(savedCFI.href)}#${savedCFI.cfi}` };
  await cfiNative.onLocationChange(visible);
  assert.equal(cfiEvents.length, count, 'A chapter callback cannot confirm the CFI anchor');
  restoreRelease(true);
  assert.equal(await attempt, true);
  assert.equal(cfiEvents.length, count + 1);
  assert.equal(cfiEvents.at(-1).cfi, savedCFI.cfi, 'Keep the exact web CFI, not visible-page text');
  assert.equal(cfiEvents.at(-1).href, savedCFI.href);
  assert.equal(cfiEvents.at(-1).reason, 'restore');
  assert.equal(cfiEvents.at(-1).sync, undefined, 'No alignment means no invented canonical place');

  const delayedLocation = {
    ...destination,
    href: savedCFI.href,
    locations: { progression: 0.75 },
  };
  await cfiNative.onLocationChange(delayedLocation);
  assert.equal(
    cfiEvents.length,
    count + 1,
    'Delayed native progression must not overwrite the CFI',
  );
  assert.equal(
    cfiEvents.at(-1).reason,
    'restore',
    'Closing without a page turn must not save again',
  );
  assert.equal(cfiEvents.at(-1).cfi, savedCFI.cfi);

  const nextCFI = 'epubcfi(/6/6!/4/2/1:500)';
  visible = { ...destination, href: `${encodeURI(savedCFI.href)}#${nextCFI}` };
  await cfiNative.onLocationChange({ ...delayedLocation, locations: { progression: 0.8 } });
  assert.equal(
    cfiEvents.length,
    count + 2,
    'A native swipe must publish its new exact page anchor',
  );
  assert.equal(cfiEvents.at(-1).cfi, nextCFI);
  assert.equal(cfiEvents.at(-1).href, encodeURI(savedCFI.href));
  assert.equal(cfiEvents.at(-1).reason, 'relocate');
}
const savedCFI = { href: 'chapter.xhtml', cfi: 'epubcfi(/6/6!/4/2/1:7)' };
const beforeCFIFailure = cfiEvents.length;
const failedCFI = cfiRef.current.restoreLocation(savedCFI);
restoreRelease(false);
assert.equal(await failedCFI, false);
assert.equal(
  cfiEvents.length,
  beforeCFIFailure,
  'Failed CFI verification cannot publish a location',
);

const supersededCFI = cfiRef.current.restoreLocation(savedCFI);
const releaseSupersededCFI = restoreRelease;
const replacingCFI = cfiRef.current.restoreLocation(savedCFI);
const releaseReplacingCFI = restoreRelease;
assert.equal(await supersededCFI, false);
releaseSupersededCFI(true);
await Promise.resolve();
const stepsBeforeReplacement = steps;
find(cfiTree, 'IconButton').onPress();
assert.equal(
  steps,
  stepsBeforeReplacement,
  'Superseded completion must keep replacement controls locked',
);
assert.equal(
  cfiEvents.length,
  beforeCFIFailure,
  'Superseded CFI success cannot publish a location',
);
visible = { ...destination, href: savedCFI.href };
releaseReplacingCFI(true);
assert.equal(await replacingCFI, true);
assert.equal(cfiEvents.length, beforeCFIFailure + 1);

const beforeUnmount = cfiEvents.length;
const lateCFI = cfiRef.current.restoreLocation(savedCFI);
const releaseLateCFI = restoreRelease;
cleanupCFI();
assert.equal(await lateCFI, false);
releaseLateCFI(true);
await Promise.resolve();
await Promise.resolve();
assert.equal(
  cfiEvents.length,
  beforeUnmount,
  'An unmounted CFI restore cannot publish late success',
);
console.log(
  'Native restoration waits for destination, ignores input, preserves offsets, and cancels on unmount.',
);
