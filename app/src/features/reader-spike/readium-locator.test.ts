import { describe, expect, test } from 'bun:test';
import type { AlignmentSegment } from '../../generated/api';
import {
  deserializeReadiumLocator,
  mapReadiumLocator,
  mapReadiumSelection,
  preferredReadiumLocator,
  readiumLocationReason,
  readiumResumeDecorations,
  readiumRestoreDisposition,
  readiumSearchQuery,
  readiumSearchQueries,
  segmentForEPUBLocator,
  serializeReadiumLocator,
} from './readium-locator';

const segment: AlignmentSegment = {
  id: 'alice-1',
  ordinal: 1,
  text: 'Alice was beginning to get very tired',
  epub_href: 'OEBPS/chapter-1.xhtml',
  epub_locator: { type: 'dom-element', dom_path: 'html[1]/body[1]/p[1]' },
  koreader_locator: '',
  audio_resource: 'alice.mp3',
  audio_start_ms: 0,
  audio_end_ms: 1000,
  highlightable: true,
  alignment_status: 'aligned',
};

describe('Readium spike locator', () => {
  test('round-trips a valid locator and rejects malformed persistence', () => {
    const locator = {
      href: '/OEBPS/chapter-1.xhtml',
      type: 'application/xhtml+xml',
      locations: { progression: 0.2 },
      text: { highlight: segment.text },
    };
    expect(deserializeReadiumLocator(serializeReadiumLocator(locator))).toEqual(locator);
    expect(deserializeReadiumLocator('{')).toBeUndefined();
  });

  test('saves the first visible text locator instead of a coarser page event', () => {
    const page = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.2 },
    };
    const visible = {
      ...page,
      text: { highlight: 'beginning to get very tired' },
    };
    expect(preferredReadiumLocator(page, visible)).toBe(visible);
    expect(preferredReadiumLocator(page)).toBe(page);
    expect(preferredReadiumLocator(page, { ...visible, href: 'OEBPS/next.xhtml' })).toBe(page);
  });

  test('suppresses startup locations until the canonical target arrives', () => {
    const target = { href: segment.epub_href, locator: segment.epub_locator, offset: 500_000 };
    expect(readiumRestoreDisposition(target, 'OEBPS/title.xhtml')).toBe('suppress');
    expect(readiumRestoreDisposition(target, `/${segment.epub_href}#page`)).toBe('restore');
    expect(readiumRestoreDisposition(undefined, 'OEBPS/title.xhtml')).toBe('publish');
  });

  test('highlights only canonical resume targets', () => {
    const locator = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.2 },
      text: { highlight: segment.text },
    };
    expect(readiumResumeDecorations(locator, false, '#accent')).toEqual([]);
    expect(readiumResumeDecorations(locator, true, '#accent')).toEqual([
      {
        name: 'resume-position',
        decorations: [
          {
            id: 'resume-position',
            locator,
            style: { type: 'highlight', tint: '#accent' },
          },
        ],
      },
    ]);
  });

  test('maps unique text context to the existing canonical EPUB locator and fails closed', () => {
    const locator = {
      href: '/OEBPS/chapter-1.xhtml#page',
      type: 'application/xhtml+xml',
      locations: { progression: 0.2 },
      text: { before: 'Before.', highlight: segment.text, after: 'After.' },
    };
    expect(mapReadiumLocator(locator, [segment])).toEqual({
      href: segment.epub_href,
      locator: segment.epub_locator,
      offset: 0,
    });
    expect(mapReadiumLocator(locator, [segment, { ...segment, id: 'duplicate' }])).toBeUndefined();
    expect(
      mapReadiumLocator({ ...locator, text: { after: 'ALICE was beginning—to get very tired!' } }, [
        segment,
      ]),
    ).toEqual({ href: segment.epub_href, locator: segment.epub_locator, offset: 0 });
    expect(
      segmentForEPUBLocator({ href: segment.epub_href, locator: segment.epub_locator, offset: 0 }, [
        segment,
      ]),
    ).toEqual(segment);
  });

  test('preserves exact within-segment position from a native text locator', () => {
    const locator = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.2 },
      text: { before: 'Alice was beginning', highlight: 'to get', after: 'very tired' },
    };
    expect(mapReadiumLocator(locator, [segment])?.offset).toBeGreaterThan(0);
  });

  test('keeps page intent through transitional locations and commits backward movement', () => {
    expect(readiumLocationReason('forward', 0.2, 0.1, false)).toEqual({
      reason: 'relocate',
      pendingDirection: 'forward',
    });
    expect(readiumLocationReason('forward', 0.2, 0.1, true)).toEqual({
      reason: 'forward',
      pendingDirection: undefined,
    });
    expect(readiumLocationReason('backward', 0.1, 0.2, true)).toEqual({
      reason: 'explicit',
      pendingDirection: undefined,
    });
    expect(readiumLocationReason(undefined, 0.1, 0.2, true).reason).toBe('explicit');
  });

  test('maps a short selection from boundary-centered context without matching adjacent text', () => {
    const bottle = {
      ...segment,
      id: 'bottle',
      text: 'This time she found a little bottle on it and round the neck was a paper label.',
    };
    const next = { ...segment, id: 'next', text: 'It was all very well to say Drink me.' };
    const locator = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.5 },
      text: {
        before: 'she found a little bottle on it and round the neck was',
        highlight: 'a',
        after: 'paper label. It was all very well to say Drink me.',
      },
    };
    expect(mapReadiumSelection(locator, 'a', [bottle, next])).toEqual({
      href: bottle.epub_href,
      locator: bottle.epub_locator,
      offset: expect.any(Number),
    });
  });

  test('maps a short selection at the start of a segment and preserves its text offset', () => {
    const previous = { ...segment, id: 'previous', text: 'The candle was blown out.' };
    const next = {
      ...segment,
      id: 'next',
      text: 'After a while, Alice decided on going into the garden.',
    };
    const locator = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.5 },
      text: {
        before: previous.text,
        highlight: 'After',
        after: 'a while, Alice decided on going into the garden.',
      },
    };
    expect(mapReadiumSelection(locator, 'After', [previous, next])).toEqual({
      href: next.epub_href,
      locator: next.epub_locator,
      offset: 0,
    });
  });

  test('keeps punctuation attached when selection context starts with a comma', () => {
    const next = {
      ...segment,
      id: 'next',
      text: 'However, this bottle was not marked “poison,” so Alice ventured to taste it.',
    };
    const locator = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.5 },
      text: {
        before: 'It is almost certain to disagree with you, sooner or later.',
        highlight: 'However',
        after: ', this bottle was not marked “poison,” so Alice ventured to taste it.',
      },
    };
    expect(mapReadiumSelection(locator, 'However', [segment, next])).toEqual({
      href: next.epub_href,
      locator: next.epub_locator,
      offset: 0,
    });
  });

  test('uses trailing context to distinguish repeated selected text', () => {
    const lines = [
      {
        ...segment,
        id: 'hatter',
        text: '“Not the same thing a bit!” said the Hatter. “You might just as well say that ‘I see what I eat’ is the same thing as ‘I eat what I see’!”',
      },
      {
        ...segment,
        id: 'hare',
        epub_locator: { type: 'dom-element', dom_path: 'html[1]/body[1]/p[18]' },
        text: '“You might just as well say,” added the March Hare, “that ‘I like what I get’ is the same thing as ‘I get what I like’!”',
      },
      {
        ...segment,
        id: 'dormouse',
        text: '“You might just as well say,” added the Dormouse, who seemed to be talking in his sleep, “that ‘I breathe when I sleep’ is the same thing as ‘I sleep when I breathe’!”',
      },
    ];
    const locator = {
      href: segment.epub_href,
      type: 'application/xhtml+xml',
      locations: { progression: 0.15384615384615385 },
      text: {
        before:
          'I mean what I say—that’s the same thing, you know. “Not the same thing a bit!” said the Hatter. “You might just as well say that “I see what I eat” is the same thing as “I eat what I see”!” “',
        highlight: 'You might just as well say,” added',
        after:
          ' the March Hare, “that ‘I like what I get’ is the same thing as ‘I get what I like’!” “You might just as well say,” added the Dormouse',
      },
    };
    expect(mapReadiumSelection(locator, locator.text.highlight, lines)).toEqual({
      href: segment.epub_href,
      locator: lines[1].epub_locator,
      offset: expect.any(Number),
    });
  });

  test('builds a restore search at the canonical within-segment offset', () => {
    const long = { ...segment, text: 'zero one two three four five six seven eight nine ten' };
    expect(readiumSearchQuery(long, 500_000)).toBe('five six seven eight nine ten');
  });

  test('falls back to a nearby word that is unique across the book', () => {
    const target = {
      ...segment,
      text: 'because they would not remember the simple rules',
    };
    const other = { ...segment, id: 'other', text: 'because simple words can repeat' };
    expect(readiumSearchQueries(target, 0, [target, other])).toEqual([
      'because they would not remember the simple rules',
      'would',
      'remember',
      'rules',
    ]);
  });

  test('finds a unique nearby fallback when the phrase words all repeat', () => {
    const target = {
      ...segment,
      text: 'common words repeat often nearby uniquemarker after common words repeat often nearby',
    };
    const other = {
      ...segment,
      id: 'other',
      text: 'common words repeat often nearby somewhere else',
    };
    expect(readiumSearchQueries(target, 0, [target, other])).toContain('uniquemarker');
  });
});
