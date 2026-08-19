import { describe, expect, test } from 'bun:test';
import { titleRequestPresentation } from './title-search';

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
});
