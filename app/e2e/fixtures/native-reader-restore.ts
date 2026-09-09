// Run in a separate Bun process: React/native bridge mocks must not leak into other tests.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

(globalThis as any).__DEV__ = false;
let searchRelease: (value: unknown) => void = () => {};
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
}));
const jsx = (type: unknown, props: unknown) => ({ type, props });
mock.module('react/jsx-runtime', () => ({ jsx, jsxs: jsx }));
mock.module('react/jsx-dev-runtime', () => ({ jsxDEV: jsx }));
mock.module('react-native', () => ({ ActivityIndicator: 'Spinner' }));
mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
mock.module('react-native-readium', () => ({ ReadiumView: 'ReadiumView' }));
mock.module('expo-file-system', () => ({ File: class {}, Paths: {} }));
mock.module('../../src/features/tw', () => ({ Text: 'Text', View: 'View' }));
mock.module('../../src/features/ui', () => ({ IconButton: 'IconButton' }));
mock.module('../../src/features/reader-save-feedback', () => ({
  ReaderSaveFeedback: 'ReaderSaveFeedback',
}));

const { EPUBReader } = await import('../../src/components/EPUBReader.native');
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
visible = destination;
await native.onLocationChange(destination);
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
assert.equal(await saved, true);
assert.equal(events.at(-1).reason, 'restore');

assert.ok(native.selectionActions.some((action: any) => action.id === 'save-place'));
const chosen = {
  ...destination,
  text: { highlight: 'waited patiently', before: 'Alice ', after: ' for the caterpillar' },
};
native.onSelectionAction({ locator: chosen, selectedText: 'waited patiently', actionId: 'save-place' });
assert.equal(events.at(-1).reason, 'explicit');
assert.deepEqual(JSON.parse(events.at(-1).cfi), chosen, 'Save the selected text, not the page start');
assert.equal(saveFeedback, undefined, 'Selection alone must not claim the save succeeded');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(destination) }, 'saved');
assert.equal(saveFeedback, undefined, 'A stale save must not confirm a different selection');
assert.equal(decorations.length, 0, 'A stale save must not highlight a different selection');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, 'saved');
assert.deepEqual(decorations[0].decorations[0].locator, chosen, 'Saving immediately highlights the exact saved sentence');
tickFeedback();
assert.equal(saveFeedback, undefined, 'The save confirmation is temporary');
assert.equal(decorations.length, 0, 'The save highlight expires with its confirmation');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'offline');
assert.equal(saveFeedback, 'offline', 'Offline confirmation distinguishes a local save');
assert.deepEqual(decorations[0].decorations[0].locator, chosen, 'A durable offline save also highlights the sentence');
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
assert.equal(events.length, countAfterSelection, 'Closing the menu must not replace the saved sentence');
await native.onLocationChange({ ...destination, locations: { progression: 0.6 } });
assert.equal(events.length, countAfterSelection + 1, 'Reading the next page resumes normal tracking');
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, undefined, 'A late save after leaving the page must not show confirmation');

const restoreChosen = ref.current.restoreLocation({ cfi: JSON.stringify(chosen) });
await native.onLocationChange(destination);
assert.equal(await restoreChosen, true);
assert.deepEqual(JSON.parse(events.at(-1).cfi), chosen, 'Reopening must retain the saved sentence');
assert.equal(decorations.length, 0, 'The cue must not expire behind the opening cover');
assert.equal(feedbackTimers.size, 0, 'Hidden restoration must not start the cue timer');
ref.current.revealRestoredPlace();
assert.deepEqual(decorations[0].decorations[0].locator, chosen, 'Reopening highlights the saved sentence');
ref.current.revealRestoredPlace();
assert.equal(feedbackTimers.size, 1, 'Repeated readiness must not restart the cue');
assert.equal(feedbackTimers.size, 1);
tickFeedback();
assert.equal(decorations.length, 0, 'The restore highlight is temporary');

const countAfterReopen = events.length;
await native.onLocationChange(destination);
assert.equal(events.length, countAfterReopen, 'A restored sentence must survive a repeated page event');

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

native.onSelectionAction({ locator: chosen, selectedText: 'waited patiently', actionId: 'save-place' });
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, 'saved');
assert.equal(feedbackTimers.size, 1);
previous.onPress();
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(saveFeedback, undefined, 'Turning the page blocks late confirmation before arrival');

native.onSelectionAction({ locator: chosen, selectedText: 'waited patiently', actionId: 'save-place' });
ref.current.confirmSavedPlace({ cfi: JSON.stringify(chosen) }, 'saved');
assert.equal(feedbackTimers.size, 1);
const canceled = ref.current.restoreLocation(destination);
cleanup();
assert.equal(feedbackTimers.size, 0, 'Unmount cancels feedback timers');
assert.equal(await canceled, false, 'Unmount cancels navigation without reporting success');
console.log(
  'Native restoration waits for destination, ignores input, preserves offsets, and cancels on unmount.',
);
