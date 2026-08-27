import { expect, test } from 'bun:test';
import type { Alignment } from '../generated/api';
import { offlineAudioToCanonical, offlineCanonicalToAudio } from './offline-position';

const alignment = {
  id: 'alignment',
  segments: [
    {
      id: 'segment',
      highlightable: true,
      audio_resource: 'book.m4b',
      audio_start_ms: 1_000,
      audio_end_ms: 3_000,
    },
  ],
} as Alignment;

test('offline audio positions preserve canonical segment offsets', () => {
  const canonical = offlineAudioToCanonical(alignment, {
    resource: 'book.m4b',
    timestamp_ms: 2_000,
  });
  expect(canonical).toMatchObject({ segment_id: 'segment', offset: 500_000 });
  expect(offlineCanonicalToAudio(alignment, canonical!)).toEqual({
    resource: 'book.m4b',
    timestamp_ms: 2_000,
  });
});

test('offline audio positions snap gaps to the nearest readable boundary', () => {
  expect(
    offlineAudioToCanonical(alignment, { resource: 'book.m4b', timestamp_ms: 0 }),
  ).toMatchObject({ segment_id: 'segment', offset: 0 });
  expect(
    offlineAudioToCanonical(alignment, { resource: 'book.m4b', timestamp_ms: 4_000 }),
  ).toMatchObject({ segment_id: 'segment', offset: 1_000_000 });
  expect(
    offlineAudioToCanonical(alignment, { resource: 'another.m4b', timestamp_ms: 0 }),
  ).toBeUndefined();
});

test('offline audio positions use the server word timing model when available', () => {
  const timed = {
    ...alignment,
    segments: [
      {
        ...alignment.segments[0],
        text: 'one two three',
        word_timings: [
          { text: 'one', startTime: 1, endTime: 1.4 },
          { text: 'two', startTime: 1.5, endTime: 1.9 },
          { text: 'three', startTime: 2, endTime: 2.8 },
        ],
      },
    ],
  } as Alignment;
  const canonical = offlineAudioToCanonical(timed, {
    resource: 'book.m4b',
    timestamp_ms: 1_700,
  });
  expect(canonical?.offset).toBe(307_692);
  expect(offlineCanonicalToAudio(timed, canonical!)?.timestamp_ms).toBe(1_500);
});
