import { expect, test } from 'bun:test';
import { flattenReaderContents } from './reader-navigation';

test('flattens native and web reader contents without losing depth', () => {
  expect(flattenReaderContents()).toEqual([]);
  expect(
    flattenReaderContents([
      {
        title: 'Part one',
        href: 'part.xhtml',
        children: [{ title: 'Chapter one', href: 'chapter.xhtml' }],
      },
      { label: 'Part two', subitems: [{ label: 'Chapter two', href: 'chapter-2.xhtml' }] },
    ]),
  ).toEqual([
    { title: 'Part one', href: 'part.xhtml', depth: 0 },
    { title: 'Chapter one', href: 'chapter.xhtml', depth: 1 },
    { title: 'Chapter two', href: 'chapter-2.xhtml', depth: 1 },
  ]);
});
