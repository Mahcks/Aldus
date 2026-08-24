import { describe, expect, test } from 'bun:test';
import type { ImportProposal, Library } from '../generated/api';
import {
  canManageSources,
  childDirectory,
  makeReviewDraft,
  mergeReviewDraft,
  parentDirectory,
} from './source-administration';

const library = (role: string): Library => ({
  id: 'library',
  name: 'Library',
  role,
  exclusive: false,
  effective: true,
  can_request_acquisitions: role === 'owner' || role === 'editor',
  can_bypass_acquisition_approval: role === 'owner' || role === 'editor',
  can_advanced_acquisition_request: role === 'owner' || role === 'editor',
  created_at: '',
  updated_at: '',
});

const proposal = (revision: number, entryIDs = ['epub', 'audio']): ImportProposal => ({
  id: 'proposal',
  library_id: 'library',
  state: 'review_required',
  confidence: 'medium',
  title: 'Alice',
  author: 'Lewis Carroll',
  normalized_title: 'alice',
  normalized_author: 'lewis carroll',
  reasons: ['Matching title and author'],
  revision,
  items: entryIDs.map((id) => ({
    source_entry_id: id,
    relative_path: `${id}.bin`,
    kind: id,
    label: id.toUpperCase(),
    sha256: id,
    duplicate: false,
    evidence: {},
  })),
  created_at: '',
  updated_at: '',
});

describe('source administration', () => {
  test('only administrators, owners, and editors can manage sources', () => {
    expect(canManageSources(true, library('reader'))).toBe(true);
    expect(canManageSources(false, library('owner'))).toBe(true);
    expect(canManageSources(false, library('editor'))).toBe(true);
    expect(canManageSources(false, library('reader'))).toBe(false);
  });

  test('a conflict keeps safe edits and drops choices for removed files', () => {
    const first = makeReviewDraft(proposal(1));
    first.title = 'Alice in Wonderland';
    first.items.audio.label = 'Narrated edition';

    const refreshed = mergeReviewDraft(proposal(2, ['audio', 'chapter-two']), first);

    expect(refreshed.title).toBe('Alice in Wonderland');
    expect(refreshed.items.audio.label).toBe('Narrated edition');
    expect(refreshed.items.epub).toBeUndefined();
    expect(refreshed.items['chapter-two'].label).toBe('CHAPTER-TWO');
  });

  test('the source picker navigates with safe relative paths', () => {
    expect(childDirectory('', 'Books')).toBe('Books');
    expect(childDirectory('Books', 'Classics')).toBe('Books/Classics');
    expect(parentDirectory('Books/Classics')).toBe('Books');
    expect(parentDirectory('Books')).toBe('');
  });
});
