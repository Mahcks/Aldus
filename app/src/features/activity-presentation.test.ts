import { describe, expect, test } from 'bun:test';
import type { TitleRequest } from '../generated/api';
import { isCancelableRequestState, isTakingLonger, requestGroup } from './activity-presentation';

const request = (states: string[]) =>
  ({ formats: states.map((state) => ({ state })) }) as TitleRequest;

describe('activity request presentation', () => {
  test('groups requests by the most useful current state', () => {
    expect(requestGroup(request(['available', 'downloading']))).toBe('active');
    expect(requestGroup(request(['available']))).toBe('ready');
    expect(requestGroup(request(['failed', 'canceled']))).toBe('history');
  });

  test('only warns after 24 hours without a download update', () => {
    const now = Date.parse('2026-08-20T12:00:00Z');
    expect(isTakingLonger('downloading', '2026-08-19T11:59:59Z', now)).toBeTrue();
    expect(isTakingLonger('downloading', '2026-08-19T12:00:01Z', now)).toBeFalse();
    expect(isTakingLonger('submitting', '2026-08-18T12:00:00Z', now)).toBeFalse();
  });

  test('does not offer cancellation after import preparation begins', () => {
    expect(isCancelableRequestState('downloading')).toBeTrue();
    expect(isCancelableRequestState('scanning')).toBeFalse();
    expect(isCancelableRequestState('needs_review')).toBeFalse();
  });
});
