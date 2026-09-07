// Run in a separate Bun process: React/native bridge mocks must not leak into other tests.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

(globalThis as any).__DEV__ = false;
let searchRelease: (value: unknown) => void = () => {};
let steps = 0;
let visible: any;
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
  useRef: (value: unknown) => ({ current: refIndex++ === 0 ? bridge : value }),
  useState: (value: unknown) => [stateIndex++ === 0 ? 'file:///book.epub' : value, () => {}],
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

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let expire: () => void = () => {};
globalThis.setTimeout = ((callback: () => void) => {
  expire = callback;
  return 1;
}) as any;
globalThis.clearTimeout = (() => {}) as any;
const expired = ref.current.restoreLocation(destination);
expire();
assert.equal(await expired, false, 'A missing destination event must fail instead of unlocking');
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

const canceled = ref.current.restoreLocation(destination);
cleanup();
assert.equal(await canceled, false, 'Unmount cancels navigation without reporting success');
console.log(
  'Native restoration waits for destination, ignores input, preserves offsets, and cancels on unmount.',
);
