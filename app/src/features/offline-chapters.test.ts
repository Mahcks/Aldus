import { expect, test } from 'bun:test';
import { offlineAudioChapters } from './offline-chapters';

test('offline chapter manifests remain backwards compatible and reject invalid entries', () => {
  expect(offlineAudioChapters(undefined)).toEqual({});
  expect(
    offlineAudioChapters({
      audio: [{ title: 'Chapter 1', start_ms: 0, end_ms: 1000 }],
      broken: [{ title: 'Broken', start_ms: 1000, end_ms: 500 }],
    }),
  ).toEqual({ audio: [{ title: 'Chapter 1', start_ms: 0, end_ms: 1000 }] });
});
