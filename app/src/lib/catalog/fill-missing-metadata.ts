import type { api } from '@/lib/api';
import type { FileMetadataPreview, MetadataValues } from '@/generated/api';
import { metadataFields, type MetadataField } from './metadata-review';

type Client = Pick<
  typeof api,
  | 'work'
  | 'representations'
  | 'media'
  | 'fileMetadata'
  | 'applyFileMetadata'
  | 'metadataCandidates'
  | 'metadataEditions'
  | 'applyMetadata'
  | 'audiobookMetadata'
  | 'applyAudiobookMetadata'
>;
export type FillResult = { fields: string[]; notes: string[] };
const key = (text: string) =>
  text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const isbn = (text: string) => text.replace(/[\s-]/g, '').toUpperCase();
const empty = (value: unknown) =>
  value == null || value === '' || value === 0 || (Array.isArray(value) && !value.length);
const blankFields = (current: MetadataValues, proposed: MetadataValues) =>
  metadataFields
    .map(([field]) => field)
    .filter((field) => empty(current[field]) && !empty(proposed[field]));

export function sameBook(current: MetadataValues, proposed: MetadataValues): boolean {
  if (current.isbn && proposed.isbn && isbn(current.isbn) === isbn(proposed.isbn)) return true;
  return (
    !!current.author.trim() &&
    key(current.title) === key(proposed.title) &&
    key(current.author) === key(proposed.author)
  );
}

// A batch calls this sequentially. Every write uses the existing selected-field,
// expected-value API; concurrent manual edits are never overwritten.
export async function fillMissingMetadata(client: Client, workID: string): Promise<FillResult> {
  const result: FillResult = { fields: [], notes: [] };
  const note = (text: string) => {
    if (!result.notes.includes(text)) result.notes.push(text);
  };
  const applied = (fields: string[]) => {
    for (const field of fields) if (!result.fields.includes(field)) result.fields.push(field);
  };
  try {
    const work = await client.work(workID);
    const recordings = await client.representations(workID);
    if (recordings.length >= 100) note('Additional recordings need manual review.');
    const groups: {
      recording: (typeof recordings)[number];
      previews: { mediaID: string; data: FileMetadataPreview }[];
      complete: boolean;
    }[] = [];
    let inspected = 0;
    for (const recording of recordings) {
      const group: (typeof groups)[number] = { recording, previews: [], complete: true };
      groups.push(group);
      const files = await client.media(work.library_id, recording.id);
      // Avoid unbounded probing of chapter-per-file books. Leave them for review.
      if (files.length >= 50 || inspected + files.length > 20) {
        group.complete = false;
        note('Too many files for automatic inspection; review file details.');
        continue;
      }
      for (const file of files) {
        inspected++;
        try {
          group.previews.push({ mediaID: file.id, data: await client.fileMetadata(file.id) });
        } catch {
          group.complete = false;
          note('Some file tags could not be read.');
        }
      }
    }
    const all = groups.flatMap((group) => group.previews);
    if (all.length && groups.every((group) => group.complete) && recordings.length < 100) {
      const first = all[0];
      const proposed = { ...first.data.current, values: { ...first.data.current.values } };
      const fields: string[] = [];
      for (const [field] of metadataFields) {
        if (field === 'cover_url' || !empty(first.data.current.values[field])) continue;
        const values = all
          .map((item) => item.data.suggested.values[field])
          .filter((value) => !empty(value));
        const unique = [...new Set(values.map((value) => JSON.stringify(value)))];
        if (unique.length > 1) {
          note('Conflicting file tags need review.');
          continue;
        }
        if (unique.length === 1) {
          Object.assign(proposed.values, { [field]: values[0] });
          fields.push(field);
        }
      }
      if (!first.data.current.series && !first.data.current.series_position) {
        const series = all.map((item) => item.data.suggested).filter((value) => value.series);
        if (
          series.length &&
          new Set(series.map((value) => JSON.stringify([value.series, value.series_position])))
            .size === 1
        ) {
          proposed.series = series[0].series;
          proposed.series_position = series[0].series_position;
          fields.push('series');
        }
      }
      if (fields.length) {
        await client.applyFileMetadata(first.mediaID, {
          fields,
          expected: first.data.current,
          values: proposed,
        });
        applied(fields);
      }
    }
    for (const { recording, previews, complete } of groups) {
      if (!complete || !previews.length || recording.kind === 'epub') continue;
      const first = previews[0];
      const names = previews
        .map((item) => item.data.suggested.narrators)
        .filter((value) => value?.length);
      if (!first.data.current.narrators?.length && names.length) {
        if (new Set(names.map((value) => JSON.stringify(value))).size !== 1) {
          note('Conflicting narrator tags need review.');
          continue;
        }
        await client.applyFileMetadata(first.mediaID, {
          fields: ['narrators'],
          expected: first.data.current,
          values: { ...first.data.current, narrators: names[0] },
        });
        applied(['narrators']);
      }
      const identifiers = [...new Set(previews.map((item) => item.data.asin).filter(Boolean))];
      if (identifiers.length !== 1) {
        if (!first.data.current.narrators?.length && !names.length) {
          note('No reliable narrator credit found; review this recording.');
        }
        continue;
      }
      try {
        const book = await client.work(workID);
        const online = await client.audiobookMetadata(workID, recording.id, identifiers[0], 'us');
        if (
          key(online.title) !== key(book.title) ||
          !book.author ||
          !online.authors.some((author) => key(author) === key(book.author!))
        ) {
          note('Audiobook identity needs review.');
          continue;
        }
        const fields = (['narrators', 'description'] as const).filter(
          (field) => empty(online.current[field]) && !empty(online.values[field]),
        );
        if (fields.length) {
          await client.applyAudiobookMetadata(workID, recording.id, {
            asin: online.asin,
            region: online.region,
            fields,
            expected: online.current,
            values: online.values,
            recording: online.recording,
          });
          applied([...fields]);
        }
      } catch {
        note('Audiobook lookup or save needs review.');
      }
    }
  } catch {
    note('File updates could not finish; details may have changed.');
  }

  try {
    const book = await client.work(workID);
    const search = await client.metadataCandidates(
      workID,
      book.isbn || `${book.title} ${book.author ?? ''}`.trim(),
    );
    const matches = search.candidates.filter((candidate) =>
      sameBook(search.current, candidate.values),
    );
    const ids = [...new Set(matches.map((candidate) => candidate.work_id))];
    if (ids.length !== 1) {
      note('No unique book match; review online suggestions.');
      return result;
    }
    const preview = await client.metadataEditions(
      workID,
      ids[0],
      search.current.language,
      search.current.isbn,
    );
    const exactEditions = preview.current.isbn
      ? preview.candidates.filter(
          (candidate) =>
            candidate.edition_id && isbn(candidate.values.isbn) === isbn(preview.current.isbn),
        )
      : [];
    const candidate =
      exactEditions.length === 1
        ? exactEditions[0]
        : preview.candidates.find((candidate) => !candidate.edition_id);
    if (!candidate || !sameBook(preview.current, candidate.values)) {
      note('Book identity needs review.');
      return result;
    }
    let fields = blankFields(preview.current, candidate.values);
    // A title/author match identifies a work, not its publication edition.
    if (!candidate.edition_id)
      fields = fields.filter(
        (field) => !(['isbn', 'publisher', 'language'] as MetadataField[]).includes(field),
      );
    if (fields.length) {
      await client.applyMetadata(workID, {
        work_id: candidate.work_id,
        edition_id: candidate.edition_id,
        fields,
        expected: preview.current,
        values: candidate.values,
      });
      applied(fields);
    }
  } catch {
    note('Online lookup or save could not finish; retry or review this book.');
  }
  return result;
}
