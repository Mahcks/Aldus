import type { WorkSummary } from '@/generated/api';

export function offlineBrowseWorks(
  works: WorkSummary[],
  options: { availability: string; sort: string; status: string },
) {
  const filtered = works.filter((work) => {
    if (options.status && work.reading_status !== options.status) return false;
    switch (options.availability) {
      case 'readable':
        return work.readable;
      case 'listenable':
        return work.listenable;
      case 'synchronized':
        return work.synchronized;
      case 'in_progress':
        return work.in_progress;
      default:
        return true;
    }
  });
  return filtered.sort((left, right) => {
    switch (options.sort) {
      case 'title':
        return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
      case 'author':
        return (
          (left.author ?? '').localeCompare(right.author ?? '') || left.id.localeCompare(right.id)
        );
      case 'updated':
        return right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id);
      case 'progress':
        return (
          (right.progress_updated_at ?? '').localeCompare(left.progress_updated_at ?? '') ||
          left.id.localeCompare(right.id)
        );
      default:
        return right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id);
    }
  });
}
