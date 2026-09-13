import type { ApplyMetadataRequest, MetadataCandidate, MetadataValues } from '@/generated/api';

export const metadataFields = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['description', 'Description'],
  ['isbn', 'ISBN'],
  ['publisher', 'Publisher'],
  ['language', 'Language'],
  ['first_publish_year', 'First published'],
  ['subjects', 'Subjects'],
  ['cover_url', 'Cover'],
] as const;

export type MetadataField = (typeof metadataFields)[number][0];

export function metadataValueText(value: MetadataValues[MetadataField]) {
  if (Array.isArray(value)) return value.join('\n');
  return value ? String(value) : '';
}

export function metadataCorrection(
  current: MetadataValues,
  candidate: MetadataCandidate,
  selected: MetadataField[],
): ApplyMetadataRequest {
  return {
    work_id: candidate.work_id,
    edition_id: candidate.edition_id,
    expected: current,
    values: candidate.values,
    fields: selected.filter(
      (field) => metadataValueText(current[field]) !== metadataValueText(candidate.values[field]),
    ),
  };
}
