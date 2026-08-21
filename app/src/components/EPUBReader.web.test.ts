import { describe, expect, test } from 'bun:test';
import {
  activeContentIndex,
  classifyPageSync,
  commitsFoliateRelocation,
  commitsReadingProgress,
  currentParagraph,
  directionAfterRelocation,
  deferredDisposal,
  disposeReaderView,
  initializeReaderView,
  relocationCursor,
  relocatedCursor,
  segmentRangeMode,
} from './reader-location';

describe('EPUB relocation', () => {
  test('uses the document owning Foliate visible range and never reuses a stale section', () => {
    const previous = {} as Document;
    const current = {} as Document;
    const missing = {} as Document;
    const contents = [
      { doc: previous, index: 3 },
      { doc: current, index: 4 },
    ];
    expect(
      activeContentIndex({ startContainer: { ownerDocument: current } } as Range, contents),
    ).toBe(4);
    expect(
      activeContentIndex({ startContainer: { ownerDocument: missing } } as Range, contents),
    ).toBeUndefined();
  });

  test('uses the containing paragraph for inline content', () => {
    const paragraph = {
      textContent: 'Alice was beginning',
      closest: () => null,
    } as unknown as HTMLParagraphElement;
    const inline = { nodeType: 1, closest: () => paragraph } as unknown as Node;
    expect(currentParagraph({ startContainer: inline } as Range)).toBe(paragraph);
  });

  test('uses the first meaningful paragraph intersecting Foliate visible range', () => {
    const empty = { textContent: '   ' } as HTMLParagraphElement;
    const first = { textContent: 'First visible' } as HTMLParagraphElement;
    const second = { textContent: 'Second visible' } as HTMLParagraphElement;
    const doc = { querySelectorAll: () => [empty, first, second] } as unknown as Document;
    const start = {
      nodeType: 3,
      parentElement: { closest: () => null },
      ownerDocument: doc,
    } as unknown as Node;
    expect(
      currentParagraph({
        startContainer: start,
        intersectsNode: (node: Node) => node === first || node === second,
      } as Range),
    ).toBe(first);
  });

  test('fails closed when no meaningful paragraph intersects the visible range', () => {
    const paragraph = { textContent: 'Outside' } as Element;
    const doc = { querySelectorAll: () => [paragraph] } as unknown as Document;
    const start = {
      nodeType: 3,
      parentElement: { closest: () => null },
      ownerDocument: doc,
    } as unknown as Node;
    expect(
      currentParagraph({ startContainer: start, intersectsNode: () => false } as unknown as Range),
    ).toBeNull();
  });

  test('keeps committed progress across relocation and only commits trustworthy cursor events', () => {
    const committed = { href: 'chapter-1', segment: 'later' };
    const visibleStart = { href: 'chapter-1', segment: 'earlier' };
    expect(relocatedCursor(committed, visibleStart, 'chapter-1')).toBe(committed);
    expect(relocatedCursor(undefined, visibleStart, 'chapter-1')).toBe(visibleStart);
    expect(relocatedCursor(committed, undefined, 'chapter-2')).toBeUndefined();
    expect(commitsReadingProgress('relocate')).toBeFalse();
    expect(commitsReadingProgress('forward')).toBeTrue();
    expect(commitsReadingProgress('explicit')).toBeTrue();
    expect(commitsFoliateRelocation('page', false, 'initial')).toBeFalse();
    expect(commitsFoliateRelocation('navigation', true, 'initial')).toBeFalse();
    expect(commitsFoliateRelocation('navigation', true, 'forward')).toBeTrue();
    expect(commitsFoliateRelocation('navigation', true, 'backward')).toBeTrue();
    expect(commitsFoliateRelocation(undefined, true, 'initial')).toBeTrue();
    expect(commitsFoliateRelocation('scroll', true, 'initial')).toBeTrue();
    expect(commitsFoliateRelocation('snap', true, 'initial')).toBeTrue();
  });

  test('commits the destination cursor when navigating across chapters', () => {
    const source = { href: 'chapter-1', segment: 'last-source-segment' };
    const destination = { href: 'chapter-2', segment: 'first-destination-segment' };

    expect(relocationCursor(source, destination, 'chapter-2', true)).toBe(destination);
    expect(relocationCursor(source, destination, 'chapter-2', false)).toBe(destination);
  });

  test('keeps page-turn intent through Foliate empty transition pages', () => {
    const afterEmpty = directionAfterRelocation('forward', false);
    expect(afterEmpty).toBe('forward');
    expect(commitsFoliateRelocation('navigation', true, afterEmpty)).toBeTrue();
    expect(directionAfterRelocation(afterEmpty, true)).toBe('initial');
  });

  test('uses the stored paragraph path when optional text boundaries are absent', () => {
    expect(segmentRangeMode({ dom_path: 'html[1]/body[1]/div[1]/p[1]' })).toBe('element');
    expect(
      segmentRangeMode({
        dom_path: 'html[1]/body[1]/div[1]/p[1]',
        start: { node_offset: 0 },
        end: { node_offset: 12 },
      }),
    ).toBe('boundaries');
    expect(segmentRangeMode({})).toBeUndefined();
  });

  test('closes Foliate before removing its element', () => {
    const calls: string[] = [];
    disposeReaderView({
      close: () => calls.push('close'),
      remove: () => calls.push('remove'),
    });
    expect(calls).toEqual(['close', 'remove']);
  });

  test('defers one-shot Foliate disposal until opening settles', () => {
    const calls: string[] = [];
    const disposal = deferredDisposal(() => calls.push('dispose'));

    disposal.request();
    expect(calls).toEqual([]);
    disposal.settle();
    disposal.request();
    disposal.fail();
    expect(calls).toEqual(['dispose']);
  });

  test('initializes Foliate at readable text after opening a new book', async () => {
    const calls: unknown[] = [];
    await initializeReaderView({
      init: async (options) => {
        calls.push(options);
      },
    });
    expect(calls).toEqual([{ showTextStart: true }]);
  });

  test('classifies full, partial, and unavailable visible pages', () => {
    expect(classifyPageSync(3, 0)).toBe('full');
    expect(classifyPageSync(3, 1)).toBe('partial');
    expect(classifyPageSync(0, 2)).toBe('none');
  });
});
