import { describe, expect, test } from 'bun:test';
import type { WorkSummary } from '../generated/api';
import { offlineBrowseWorks } from './offline-browse';

const work = (value: Partial<WorkSummary> & Pick<WorkSummary, 'id' | 'title'>) =>
  ({
    author: '',
    readable: false,
    listenable: false,
    synchronized: false,
    in_progress: false,
    reading_status: '',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    progress_updated_at: '',
    ...value,
  }) as WorkSummary;

describe('offlineBrowseWorks', () => {
  test('applies the same status, availability, and sort choices offline', () => {
    const works = [
      work({ id: '2', title: 'Beta', readable: true, reading_status: 'finished' }),
      work({ id: '1', title: 'Alpha', readable: true, reading_status: 'want_to_read' }),
      work({ id: '3', title: 'Gamma', listenable: true, reading_status: 'want_to_read' }),
    ];
    expect(
      offlineBrowseWorks(works, {
        availability: 'readable',
        sort: 'title',
        status: 'want_to_read',
      }).map((item) => item.id),
    ).toEqual(['1']);
  });
});
