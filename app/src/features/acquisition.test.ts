import { expect, test } from 'bun:test';
import {
  acquisitionDate,
  acquisitionCounterparts,
  acquisitionFailureMessage,
  acquisitionFulfillment,
  acquisitionSize,
  groupAcquisitionResults,
  parseAcquisitionRelease,
  scoreAcquisitionRelevance,
} from './acquisition';
import type { AcquisitionRequest, AcquisitionResult } from '../generated/api';

const request = {
  id: 'request',
  library_id: 'library',
  requested_by: 'user',
  query: 'Alice',
  status: 'queued',
  download_state: 'downloading',
  fulfillment_state: 'downloading',
  selected_title: 'Alice in Wonderland [EPUB]',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} satisfies AcquisitionRequest;

test('presents persisted acquisition fulfillment states truthfully', () => {
  expect(acquisitionFulfillment(request)?.label).toBe('Downloading');
  expect(acquisitionFulfillment({ ...request, fulfillment_state: 'scanning' })?.label).toBe(
    'Scanning',
  );
  expect(
    acquisitionFulfillment({
      ...request,
      fulfillment_state: 'failed',
      download_error: 'scan failed',
    })?.tone,
  ).toBe('danger');
  expect(acquisitionFulfillment({ ...request, fulfillment_state: 'needs_review' })?.action).toBe(
    'review',
  );
  expect(acquisitionFulfillment({ ...request, fulfillment_state: 'available' })?.action).toBe(
    'open',
  );
  expect(acquisitionFulfillment({ ...request, selected_title: undefined })).toBeNull();
});

test('hides raw magnet failures from the primary acquisition message', () => {
  expect(
    acquisitionFailureMessage({
      ...request,
      download_error: 'download torrent from indexer: Get "magnet:?xt=urn:btih:secret"',
    }),
  ).toBe('The download client did not accept this request. Check its connection and try again.');
});

test('formats acquisition metadata without exposing invalid values', () => {
  expect(acquisitionSize(0)).toBe('Size unknown');
  expect(acquisitionSize(1536)).toBe('1.5 KB');
  expect(acquisitionSize(2 * 1024 ** 3)).toBe('2.0 GB');
  expect(acquisitionDate('not-a-date')).toBe('');
});

test('parses a leading "Author - Title" release with bracketed format and year', () => {
  const parsed = parseAcquisitionRelease(
    'J.R.R. Tolkien - The Fellowship of the Ring (2001) [EPUB]',
  );
  expect(parsed.title).toBe('The Fellowship of the Ring');
  expect(parsed.author).toBe('J.R.R. Tolkien');
  expect(parsed.format).toBe('EPUB');
});

test('parses a dotted scene release with a trailing group tag and no confident author', () => {
  const parsed = parseAcquisitionRelease('The.Fellowship.of.the.Ring.2001.EPUB.RETAIL-GROUP');
  expect(parsed.title).toBe('The Fellowship of the Ring');
  expect(parsed.author).toBeUndefined();
  expect(parsed.format).toBe('EPUB');
});

test('parses a "Title by Author" release with a multi-format bracket', () => {
  const parsed = parseAcquisitionRelease(
    'The Left Hand of Darkness by Ursula K. Le Guin [EPUB, MOBI]',
  );
  expect(parsed.title).toBe('The Left Hand of Darkness');
  expect(parsed.author).toBe('Ursula K. Le Guin');
  expect(parsed.format).toBe('EPUB');
});

test('recognizes an audiobook format token without a confident author', () => {
  const parsed = parseAcquisitionRelease('Piranesi Unabridged M4B Audiobook');
  expect(parsed.title).toBe('Piranesi');
  expect(parsed.author).toBeUndefined();
  expect(parsed.format).toBe('M4B');
});

test('falls back to a cleaned title when nothing else is confidently parsed', () => {
  const parsed = parseAcquisitionRelease('some_weird_release_name_123');
  expect(parsed.title).toBe('some weird release name 123');
  expect(parsed.author).toBeUndefined();
  expect(parsed.format).toBeUndefined();
});

test('ranks tie-in and derivative works below closer title matches', () => {
  const query = 'lord of the rings';
  const ranked = [
    "Smart Pop Explains Peter Jackson's The Lord of the Rings and The Hobbit Movies",
    'The Unofficial Lord of the Rings Cookbook: From Hobbiton to Mordor Over 60 Recipes',
    'The Lord of the Rings and Philosophy One Book to Rule Them All',
    'The Fellowship of the Knits: Lord of the Rings: The Unofficial Knitting Book',
    "Frodo's Journey: Discover the Hidden Meaning of The Lord of the Rings",
    'Middle Earth Strategy Battle Game: Armies of The Lord of the Rings',
  ]
    .map((title) => ({ title, score: scoreAcquisitionRelevance(query, title) }))
    .sort((a, b) => b.score - a.score);

  const rankOf = (needle: string) => ranked.findIndex((entry) => entry.title.includes(needle));

  expect(rankOf('Smart Pop')).toBeLessThan(rankOf('Cookbook'));
  expect(rankOf('Smart Pop')).toBeLessThan(rankOf('Knits'));
  expect(rankOf('Philosophy')).toBeLessThan(rankOf('Cookbook'));
  expect(rankOf('Philosophy')).toBeLessThan(rankOf('Knits'));
});

test('scores an exact title match highest', () => {
  const exact = scoreAcquisitionRelevance('the left hand of darkness', 'The Left Hand of Darkness');
  const derivative = scoreAcquisitionRelevance(
    'the left hand of darkness',
    'The Unofficial Left Hand of Darkness Companion Guide',
  );
  expect(exact).toBeGreaterThan(derivative);
});

test('groups server-normalized releases and keeps exact matches ahead of related titles', () => {
  const release = (id: string, overrides: Partial<AcquisitionResult>): AcquisitionResult => ({
    id,
    title: id,
    source: 'Books',
    canonical_title: 'The Lord of the Rings',
    format: 'EPUB',
    kind: 'ebook',
    group_key: 'lord-of-the-rings',
    match: 'exact',
    size: 100,
    relevance: 100,
    ...overrides,
  });
  const groups = groupAcquisitionResults([
    release('guide', {
      canonical_title: 'A Guide to The Lord of the Rings',
      group_key: 'guide',
      match: 'related',
      relevance: 20,
    }),
    release('ebook', {}),
    release('audio', { format: 'M4B', kind: 'audiobook' }),
  ]);

  expect(groups.map((group) => group.key)).toEqual(['lord-of-the-rings', 'guide']);
  expect(groups[0].releases.map((item) => item.id)).toEqual(['ebook', 'audio']);
});

test('resolves only explicit opposite-format counterpart IDs', () => {
  const release = (id: string, kind: 'ebook' | 'audiobook'): AcquisitionResult => ({
    id,
    title: id,
    source: 'Books',
    canonical_title: 'Dune',
    format: kind === 'ebook' ? 'EPUB' : 'M4B',
    kind,
    group_key: 'dune',
    match: 'exact',
    size: 100,
    relevance: 100,
  });
  const ebook = {
    ...release('ebook', 'ebook'),
    match_confidence: 'likely' as const,
    likely_pair_ids: ['audio', 'other-ebook', 'missing'],
  };
  const audio = release('audio', 'audiobook');
  const otherEbook = release('other-ebook', 'ebook');

  expect(acquisitionCounterparts(ebook, [ebook, audio, otherEbook]).map((item) => item.id)).toEqual(
    ['audio'],
  );
  expect(acquisitionCounterparts({ ...ebook, match_confidence: '' }, [audio])).toEqual([]);
});
