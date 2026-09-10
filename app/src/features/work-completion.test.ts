import { expect, test } from 'bun:test';
import type { Alignment } from '@/generated/api';
import { editionCompletion, offlineCompletion } from './work-completion';

test('completion uses whole-book fractions, never chapter fractions or malformed data', () => {
  expect(
    editionCompletion({
      cfi: JSON.stringify({ locations: { totalProgression: 0.42, progression: 0.9 } }),
    }),
  ).toBe(42);
  expect(editionCompletion({ totalProgression: 0 })).toBe(0);
  expect(editionCompletion({ totalProgression: 1 })).toBe(100);
  for (const value of [
    { locations: { progression: 0.9 } },
    { totalProgression: 2 },
    { totalProgression: NaN },
    { cfi: 'epubcfi(/6/2)' },
  ])
    expect(editionCompletion(value)).toBeUndefined();
});

test('offline completion follows the saved canonical position instead of the download-time summary', () => {
  const alignment = {
    id: 'a',
    segments: [
      { id: 'one', ordinal: 0, highlightable: true },
      { id: 'two', ordinal: 1, highlightable: true },
    ],
  } as Alignment;
  expect(
    offlineCompletion(
      { alignment_id: 'a', segment_id: 'two', offset: 500000 },
      alignment,
      { totalProgression: 0.1 },
      0,
    ),
  ).toBe(75);
  expect(offlineCompletion(null, undefined, { totalProgression: 0.42 }, 0)).toBe(42);
  expect(offlineCompletion(null, undefined, {}, 20)).toBe(20);
});
