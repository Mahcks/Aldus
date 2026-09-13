import { describe, expect, test } from 'bun:test';
import {
  formatSizeLimit,
  parseFormats,
  parseSizeLimit,
  validFormats,
  validPolicyToken,
} from './acquisition-policy-form';

describe('acquisition policy form', () => {
  test('round-trips human-readable size limits', () => {
    expect(formatSizeLimit(200 * 1024 ** 2)).toBe('200 MB');
    expect(formatSizeLimit(5 * 1024 ** 3)).toBe('5 GB');
    expect(parseSizeLimit('1.5 GB')).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseSizeLimit('lots')).toBeUndefined();
  });

  test('normalizes and validates format lists', () => {
    expect(parseFormats('.EPUB, pdf epub')).toEqual(['epub', 'pdf']);
    expect(validFormats(['epub', 'azw3'])).toBeTrue();
    expect(validFormats([])).toBeFalse();
    expect(validFormats(['not valid'])).toBeFalse();
  });

  test('validates language tokens', () => {
    expect(validPolicyToken('en-us')).toBeTrue();
    expect(validPolicyToken('English (US)')).toBeFalse();
  });
});
