import { describe, expect, test } from 'bun:test';
import type { TitleRequestEvent } from '@/generated/api';
import { groupRequestEvents, requestEventDetail } from './request-timeline-presentation';

describe('request event presentation', () => {
  test('describes durable states without release names or implementation details', () => {
    expect(requestEventDetail('downloading')).toBe('The download started.');
    expect(requestEventDetail('awaiting_release')).toBe(
      'No matching release yet. Aldus will keep looking.',
    );
    expect(requestEventDetail('unknown-internal-event')).toBe('Request updated.');
  });
});

test('combines repeated watch checks but preserves failures, milestones, and formats', () => {
  const event = (event_type: string, format = 'ebook'): TitleRequestEvent => ({
    event_type,
    format,
    created_at: '2026-09-07T12:00:00Z',
  });
  const events = [
    event('available'),
    ...Array.from({ length: 40 }, () => [event('no_match'), event('search_started')]).flat(),
    event('search_failed'),
    event('search_started'),
    event('no_match', 'audiobook'),
    event('approved'),
  ];
  const groups = groupRequestEvents(events);
  expect(groups.map(({ event }) => event.event_type)).toEqual([
    'available',
    'no_match',
    'search_failed',
    'no_match',
    'approved',
  ]);
  expect(groups[1]).toEqual({ event: events[1], checks: 40 });
  expect(groupRequestEvents([])).toEqual([]);
  expect(events).toHaveLength(85);
});

test('groups repeated submission failures separately from no matches', () => {
  const events: TitleRequestEvent[] = Array.from({ length: 27 }, () => [
    {
      event_type: 'submission_failed',
      state: 'awaiting_release',
      format: 'ebook',
      created_at: '2026-09-07T12:00:00Z',
    },
    {
      event_type: 'search_started',
      state: 'searching',
      format: 'ebook',
      created_at: '2026-09-07T11:59:00Z',
    },
  ]).flat();
  expect(groupRequestEvents(events)).toEqual([{ event: events[0], checks: 27 }]);
  expect(requestEventDetail('awaiting_release', 'submission_failed')).toContain('download client');
  expect(requestEventDetail('awaiting_release', 'search_failed')).toContain(
    'search could not complete',
  );
});
