import { describe, expect, test } from 'bun:test';
import { titleRequestDetail, titleRequestPresentation } from './title-search';

describe('title request presentation', () => {
  test('uses plain language for the durable lifecycle', () => {
    expect(titleRequestPresentation('pending_approval')?.label).toBe('Awaiting approval');
    expect(titleRequestPresentation('awaiting_release')?.label).toBe('Watching');
    expect(titleRequestPresentation('downloading')?.label).toBe('Downloading');
    expect(titleRequestPresentation('importing')?.label).toBe('Preparing');
  });

  test('only offers another request after terminal unsuccessful states', () => {
    expect(titleRequestPresentation('searching')?.requestable).toBeFalse();
    expect(titleRequestPresentation('failed')?.requestable).toBeTrue();
    expect(titleRequestPresentation('canceled')?.requestable).toBeTrue();
  });

  test('explains request progress and preserves useful errors', () => {
    const format = {
      format: 'ebook',
      state: 'awaiting_release',
      retry_count: 1,
      updated_at: '2026-08-20T12:00:00Z',
    };
    expect(titleRequestDetail(format)).toBe('No matching release yet. Aldus will keep looking.');
    expect(titleRequestDetail({ ...format, error: 'Indexer unavailable' })).toBe(
      'Indexer unavailable',
    );
  });
});
