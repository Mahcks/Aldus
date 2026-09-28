import { expect, test } from 'bun:test';
import type { MetadataValues, FileMetadataPreview } from '@/generated/api';
import { fillMissingMetadata, sameBook } from './fill-missing-metadata';

const values: MetadataValues = {
  title: 'A book',
  author: 'An author',
  description: '',
  isbn: '',
  publisher: '',
  language: '',
  first_publish_year: 0,
  subjects: [],
  cover_url: '',
};
function fixture() {
  let current = { ...values, description: 'My manual description.' };
  const writes: { fields: string[]; expected: unknown; values: unknown }[] = [];
  const file: FileMetadataPreview = {
    asin: '',
    current: { values: current, series: '', series_position: '', narrators: [] },
    suggested: {
      values: { ...values, description: 'From file', language: 'eng' },
      series: '',
      series_position: '',
      narrators: ['A narrator'],
    },
  };
  const client = {
    work: async () => ({ id: 'book', library_id: 'library', ...current }),
    representations: async () => [
      { id: 'recording', work_id: 'book', kind: 'audio', narrators: [] },
    ],
    media: async () => [{ id: 'file', representation_id: 'recording', kind: 'audio' }],
    fileMetadata: async () => structuredClone(file),
    applyFileMetadata: async (_id: string, body: (typeof writes)[number]) => {
      writes.push(body);
      if (body.fields.includes('language')) current = { ...current, language: 'eng' };
    },
    metadataCandidates: async () => ({
      current,
      candidates: [{ work_id: 'OL1W', edition_id: '', values }],
    }),
    metadataEditions: async () => ({
      current,
      candidates: [
        {
          work_id: 'OL1W',
          edition_id: '',
          values: {
            ...values,
            description: 'Online description',
            publisher: 'Unverified edition publisher',
            subjects: ['Adventure'],
          },
        },
      ],
    }),
    applyMetadata: async (_id: string, body: (typeof writes)[number]) => {
      writes.push(body);
    },
    audiobookMetadata: async () => {
      throw new Error('No identifier should be guessed');
    },
    applyAudiobookMetadata: async () => {
      throw new Error('No recording match');
    },
  };
  const run = () =>
    fillMissingMetadata(client as unknown as Parameters<typeof fillMissingMetadata>[0], 'book');
  return { client, file, writes, run };
}

test('fills only blanks from file and a unique work, preserving manual text and edition fields', async () => {
  const f = fixture();
  const result = await f.run();
  expect(f.writes.map((write) => write.fields)).toEqual([
    ['language'],
    ['narrators'],
    ['subjects'],
  ]);
  expect(result.fields).toEqual(['language', 'narrators', 'subjects']);
  expect(result.notes).toEqual([]);
});

test('ambiguous works and conflicting file tags remain for review', async () => {
  const f = fixture();
  f.client.media = async () => [
    { id: 'one', representation_id: 'recording', kind: 'audio' },
    { id: 'two', representation_id: 'recording', kind: 'audio' },
  ];
  let probes = 0;
  f.client.fileMetadata = async () => {
    const preview = structuredClone(f.file);
    if (probes++ > 0) {
      preview.suggested.values.language = 'fra';
      preview.suggested.narrators = ['Someone else'];
    }
    return preview;
  };
  f.client.metadataCandidates = async () => ({
    current: values,
    candidates: [
      { work_id: 'OL1W', edition_id: '', values },
      { work_id: 'OL2W', edition_id: '', values },
    ],
  });
  const result = await f.run();
  expect(f.writes).toEqual([]);
  expect(result.notes).toContain('Conflicting file tags need review.');
  expect(result.notes).toContain('Conflicting narrator tags need review.');
  expect(result.notes).toContain('No unique book match; review online suggestions.');
});

test('failed writes are reported and never retried with an overwritten expectation', async () => {
  const f = fixture();
  f.client.applyFileMetadata = async () => {
    throw new Error('409');
  };
  const result = await f.run();
  expect(result.notes).toContain('File updates could not finish; details may have changed.');
  expect(f.writes.map((write) => write.fields)).toEqual([['subjects']]);
});

test('title alone never authorizes a match; exact ISBN can establish edition identity', () => {
  expect(sameBook({ ...values, author: '' }, values)).toBe(false);
  expect(sameBook(values, { ...values, author: 'Someone else' })).toBe(false);
  expect(
    sameBook(
      { ...values, isbn: '978-1234567890' },
      { ...values, isbn: '9781234567890', author: '' },
    ),
  ).toBe(true);
});

test('an exact edition identifier permits filling publication details', async () => {
  const f = fixture();
  const current = { ...values, isbn: '9781234567890' };
  f.client.representations = async () => [];
  f.client.metadataCandidates = async () => ({
    current,
    candidates: [{ work_id: 'OL1W', edition_id: '', values: current }],
  });
  f.client.metadataEditions = async () => ({
    current,
    candidates: [
      {
        work_id: 'OL1W',
        edition_id: 'OL2M',
        values: {
          ...current,
          description: 'Full description',
          publisher: 'Exact edition publisher',
          subjects: [],
        },
      },
    ],
  });
  await f.run();
  expect(f.writes[0].fields).toEqual(['description', 'publisher']);
});

test('an audiobook identifier never permits credits from a mismatched book', async () => {
  const f = fixture();
  f.file.asin = 'B08G9PRS1K';
  f.file.suggested.narrators = [];
  let appliedRecording = false;
  const client = {
    ...f.client,
    audiobookMetadata: async () => ({
      asin: f.file.asin,
      region: 'us',
      title: 'Another book',
      authors: ['An author'],
      current: { narrators: [], description: 'Manual description' },
      values: { narrators: ['Wrong narrator'], description: 'Wrong recording' },
      recording: {},
    }),
    applyAudiobookMetadata: async () => {
      appliedRecording = true;
    },
  };
  const result = await fillMissingMetadata(
    client as unknown as Parameters<typeof fillMissingMetadata>[0],
    'book',
  );
  expect(appliedRecording).toBe(false);
  expect(result.notes).toContain('Audiobook identity needs review.');
});
