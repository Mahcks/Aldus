import type { ImportProposal, Library } from '@/generated/api';

/** The representation kinds the server accepts, shared by every admin surface that creates or edits one. */
export const representationKinds = [
  { value: 'epub', label: 'EPUB' },
  { value: 'audio', label: 'Audio' },
  { value: 'audiobook', label: 'Audiobook' },
];

export type ReviewDraft = {
  title: string;
  author: string;
  workID: string;
  items: Record<string, { kind: string; label: string; representationID: string }>;
};

export function canManageSources(admin: boolean, library?: Library) {
  return admin || library?.role === 'owner' || library?.role === 'editor';
}

export function makeReviewDraft(proposal: ImportProposal): ReviewDraft {
  return {
    title: proposal.title,
    author: proposal.author,
    workID: proposal.existing_work_id ?? '',
    items: Object.fromEntries(
      proposal.items.map((item) => [
        item.source_entry_id,
        { kind: item.kind, label: item.label, representationID: '' },
      ]),
    ),
  };
}

export function mergeReviewDraft(proposal: ImportProposal, current?: ReviewDraft): ReviewDraft {
  const fresh = makeReviewDraft(proposal);
  if (!current) return fresh;
  return {
    ...fresh,
    title: current.title,
    author: current.author,
    workID: current.workID,
    items: Object.fromEntries(
      proposal.items.map((item) => [
        item.source_entry_id,
        current.items[item.source_entry_id] ?? fresh.items[item.source_entry_id],
      ]),
    ),
  };
}

export function parentDirectory(path: string) {
  return path.split('/').slice(0, -1).join('/');
}

export function childDirectory(path: string, child: string) {
  return [path, child].filter(Boolean).join('/');
}

/**
 * Derives a reasonable default source name from the last segment of a
 * filesystem path, e.g. `/library/media/scifi` -> "Scifi",
 * `/mnt/books/sci-fi_classics` -> "Sci Fi Classics". Purely a starting
 * point; callers should let the admin edit it freely.
 */
export function deriveSourceName(path: string): string {
  const segment = path.split('/').filter(Boolean).pop() ?? '';
  if (!segment) return '';
  return segment
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}
