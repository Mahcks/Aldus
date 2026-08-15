import { describe, expect, test } from 'bun:test';
import type { AlignmentSegment } from '../../generated/api';
import {
  deserializeReadiumLocator,
  mapReadiumLocator,
  mapReadiumSelection,
  readiumSearchQuery,
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

  test('builds a restore search at the canonical within-segment offset', () => {
    const long = { ...segment, text: 'zero one two three four five six seven eight nine ten' };
    expect(readiumSearchQuery(long, 500_000)).toBe('five six seven eight nine ten');
  });
});
