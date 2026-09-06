import { expect, test } from 'bun:test';
import type { MetadataCandidate, MetadataValues } from '@/generated/api';
import { metadataCorrection } from './metadata-review';

test('metadata apply retains the preview, includes selected changes only, and supports explicit clear', () => {
  const current: MetadataValues = {
    title: 'Manual',
    author: 'Author',
    description: 'Keep',
    isbn: '',
    publisher: 'Press',
    language: 'eng',
    first_publish_year: 1865,
    subjects: ['Fantasy'],
    cover_url: '',
  };
  const candidate: MetadataCandidate = {
    work_id: 'OL1W',
    edition_id: 'OL2M',
    values: { ...current, title: 'Suggested', description: '', language: 'spa' },
  };
  const correction = metadataCorrection(current, candidate, ['description', 'language', 'author']);
  expect(correction.fields).toEqual(['description', 'language']);
  expect(correction.expected).toEqual(current);
  expect(correction.values.description).toBe('');
  expect(correction.expected.description).toBe('Keep');
  expect(metadataCorrection(current, candidate, []).fields).toEqual([]);
});
