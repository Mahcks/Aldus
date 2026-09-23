import { expect, test } from 'bun:test';
import { fallbackCoverURL } from './cover-artwork';

test('a failed audiobook image falls back to the other cover, never itself', () => {
  const work = { cover_url: '/audio', audiobook_cover_url: '/audio', ebook_cover_url: '/ebook' };
  expect(fallbackCoverURL(work, 'audiobook')).toBe('/ebook');
  expect(fallbackCoverURL(work, 'ebook')).toBe('/audio');
  expect(fallbackCoverURL({ ...work, ebook_cover_url: '' }, 'audiobook')).toBeUndefined();
  expect(
    fallbackCoverURL({ ...work, ebook_cover_url: '', cover_url: '/custom' }, 'audiobook'),
  ).toBe('/custom');
});
