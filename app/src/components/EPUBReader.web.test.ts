import { describe, expect, test } from 'bun:test';
import { activeContentIndex, classifyPageSync, commitsReadingProgress, currentParagraph, relocatedCursor } from './reader-location';

describe('EPUB relocation', () => {
  test('uses the document owning Foliate visible range and never reuses a stale section', () => {
    const previous = {} as Document; const current = {} as Document; const missing = {} as Document;
    const contents = [{ doc: previous, index: 3 }, { doc: current, index: 4 }];
    expect(activeContentIndex({ startContainer: { ownerDocument: current } } as Range, contents)).toBe(4);
    expect(activeContentIndex({ startContainer: { ownerDocument: missing } } as Range, contents)).toBeUndefined();
  });

  test('uses the containing paragraph for inline content', () => {
    const paragraph = { textContent: 'Alice was beginning', closest: () => null } as unknown as HTMLParagraphElement;
    const inline = { nodeType: 1, closest: () => paragraph } as unknown as Node;
    expect(currentParagraph({ startContainer: inline } as Range)).toBe(paragraph);
  });

  test('uses the first meaningful paragraph intersecting Foliate visible range', () => {
    const empty = { textContent: '   ' } as HTMLParagraphElement; const first = { textContent: 'First visible' } as HTMLParagraphElement; const second = { textContent: 'Second visible' } as HTMLParagraphElement;
    const doc = { querySelectorAll: () => [empty, first, second] } as unknown as Document;
    const start = { nodeType: 3, parentElement: { closest: () => null }, ownerDocument: doc } as unknown as Node;
    expect(currentParagraph({ startContainer: start, intersectsNode: (node: Node) => node === first || node === second } as Range)).toBe(first);
  });

  test('fails closed when no meaningful paragraph intersects the visible range', () => {
    const paragraph = { textContent: 'Outside' } as Element;
    const doc = { querySelectorAll: () => [paragraph] } as unknown as Document;
    const start = { nodeType: 3, parentElement: { closest: () => null }, ownerDocument: doc } as unknown as Node;
    expect(currentParagraph({ startContainer: start, intersectsNode: () => false } as unknown as Range)).toBeNull();
  });

  test('keeps committed progress across relocation and only commits trustworthy cursor events', () => {
    const committed = { segment: 'later' }; const visibleStart = { segment: 'earlier' };
    expect(relocatedCursor(committed, visibleStart)).toBe(committed);
    expect(relocatedCursor(undefined, visibleStart)).toBe(visibleStart);
    expect(commitsReadingProgress('relocate')).toBeFalse();
    expect(commitsReadingProgress('forward')).toBeTrue();
    expect(commitsReadingProgress('explicit')).toBeTrue();
  });

  test('classifies full, partial, and unavailable visible pages', () => {
    expect(classifyPageSync(3, 0)).toBe('full');
    expect(classifyPageSync(3, 1)).toBe('partial');
    expect(classifyPageSync(0, 2)).toBe('none');
  });
});
