import { expect, test } from 'bun:test';
import { representationStateUpdate } from './offline-representation';

test('offline representation retries omit server-owned fields', () => {
  expect(
    representationStateUpdate(
      {
        representation_id: 'representation',
        epub_locator: { href: 'chapter.xhtml' },
        reader_layout: 'paginated',
        revision: 4,
        updated_at: '2026-01-01T00:00:00Z',
      },
      7,
    ),
  ).toEqual({
    epub_locator: { href: 'chapter.xhtml' },
    reader_layout: 'paginated',
    expected_revision: 7,
  });
});
