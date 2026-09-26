import { expect, test } from 'bun:test';
import type { CanonicalPosition, Media } from '@/generated/api';
import {
  parseSelection,
  savedSelection,
  withResumeSelection,
  rebindChosenSelection,
} from './resume-selection';
const media = { id: 'epub', sha256: 'original' } as Media;
const point: CanonicalPosition = { alignment_id: 'a', segment_id: 's', offset: 42, revision: 7 };
const range = {
  href: 'chapter.xhtml',
  text: 'The table was a large one',
  before: 'Before. ',
  after: ' After.',
};
const target = { href: range.href, offset: 42 };
const saved = { ...target, resume_selection: savedSelection(range, media, point) };

test('full range follows exactly its saved point/revision and media', () => {
  expect(withResumeSelection(target, saved, media, point)).toEqual({
    ...target,
    resume_selection: saved.resume_selection,
  });
  for (const next of [
    { ...point, revision: 8 },
    { ...point, offset: 43 },
    { ...point, alignment_id: 'new' },
  ])
    expect(withResumeSelection(target, saved, media, next)).toEqual(target);
  expect(withResumeSelection(target, saved, { ...media, sha256: 'changed' }, point)).toEqual(
    target,
  );
  expect(withResumeSelection(target, saved, media, null)).toEqual(target);
});
test('offline local range binds to the queued revision and remains valid after acknowledgement', () => {
  const pending = {
    alignment_id: 'a',
    segment_id: 's',
    offset: 42,
    expected_revision: 6,
    source_device: 'ios',
  };
  expect(withResumeSelection(target, saved, media, { ...point, revision: 6 }, pending)).toEqual({
    ...target,
    resume_selection: saved.resume_selection,
  });
  expect(withResumeSelection(target, saved, media, point)).toEqual({
    ...target,
    resume_selection: saved.resume_selection,
  });
  expect(
    withResumeSelection(target, saved, media, { ...point, offset: 80 }, { ...pending, offset: 80 }),
  ).toEqual(target);
});
test('unaligned selections survive but replacements never apply their old point', () => {
  const edition = { ...target, resume_selection: savedSelection(range, media) };
  expect(withResumeSelection(edition, edition, media)).toEqual(edition);
  expect(withResumeSelection(edition, edition, { ...media, sha256: 'changed' })).toEqual({
    ...target,
    stale_selection_file: true,
  });
  expect(withResumeSelection(edition, edition, media, point)).toEqual(target);
  expect(withResumeSelection({ ...target, href: 'other.xhtml' }, saved, media, point)).toEqual({
    ...target,
    href: 'other.xhtml',
  });
});
test('legacy and malformed saved data fail closed without changing the canonical target', () => {
  expect(withResumeSelection(target, { cfi: 'old' }, media, point)).toEqual(target);
  expect(parseSelection({ ...range, text: 'x'.repeat(16001) })).toBeUndefined();
  expect(parseSelection({ ...range, text: '   ' })).toBeUndefined();
  expect(parseSelection({ ...range, after: 123 })).toBeUndefined();
});

test('choosing a local conflict rebinds only its own passage to the accepted revision', () => {
  expect(
    rebindChosenSelection(saved, media, { ...point, revision: 12 })?.resume_selection.progress
      .revision,
  ).toBe(12);
  expect(rebindChosenSelection(saved, media, { ...point, offset: 43 })).toBeUndefined();
  expect(rebindChosenSelection(saved, { ...media, sha256: 'replaced' }, point)).toBeUndefined();
});
