import type { ImportProposal, Library } from '../generated/api';

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
