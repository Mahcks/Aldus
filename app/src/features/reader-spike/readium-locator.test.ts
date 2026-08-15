import { describe, expect, test } from 'bun:test';
import type { AlignmentSegment } from '../../generated/api';
import {
  deserializeReadiumLocator,
  mapReadiumLocator,
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
      mapReadiumLocator({ ...locator, text: { after: 'Alice was beginning to get very tired' } }, [
        segment,
      ]),
    ).toEqual({ href: segment.epub_href, locator: segment.epub_locator, offset: 0 });
    expect(
      segmentForEPUBLocator({ href: segment.epub_href, locator: segment.epub_locator, offset: 0 }, [
        segment,
      ]),
    ).toEqual(segment);
  });
});
