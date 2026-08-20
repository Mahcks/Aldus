import { describe, expect, test } from 'bun:test';
import { requestEventDetail } from './request-timeline-presentation';

describe('request event presentation', () => {
  test('describes durable states without release names or implementation details', () => {
    expect(requestEventDetail('downloading')).toBe('The download started.');
    expect(requestEventDetail('awaiting_release')).toBe(
      'No matching release yet. Aldus will keep looking.',
    );
    expect(requestEventDetail('unknown-internal-event')).toBe('Request updated.');
  });
});
