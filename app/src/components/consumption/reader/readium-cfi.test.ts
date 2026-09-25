import { expect, test } from 'bun:test';
import { parseSavedEPUBCFI, savedEPUBCFI } from './readium-cfi';

test('transports real saved web CFIs without replacing their exact anchor', () => {
  for (const saved of [
    { href: 'titlepage.xhtml', cfi: 'epubcfi(/6/2!/4/2,,/2)' },
    {
      href: 'Suzanne Collins - Hunger Games 2 - Catching Fire_split_1.html',
      cfi: 'epubcfi(/6/6!/4,/108/2/1:448,/128/2/1:342)',
    },
    { href: 'Text/chapter.xhtml', cfi: 'epubcfi(/6/6[chapter]!/4/2/1:7)' },
    { href: 'Text/chapter.xhtml', cfi: 'epubcfi(/6/6!/4/2[escaped^]id]/1:7[before,after])' },
  ]) {
    const locator = parseSavedEPUBCFI(saved)!;
    expect(locator.href).toBe(`${saved.href}#${saved.cfi}`);
    expect(savedEPUBCFI(locator)).toEqual(saved);
    expect(locator.text).toBeUndefined();
  }
});

test('rejects malformed or unsupported CFIs instead of fabricating a page-start restore', () => {
  for (const cfi of [
    '',
    '{}',
    'epubcfi(/6/6)',
    'epubcfi(/6/6!/4!/2)',
    'epubcfi(/6/6!/4/2~10)',
    'epubcfi(/6/6!/4/2@10:20)',
    'epubcfi(/6/6!/4/2/1:-1)',
    'epubcfi(/6/6!/4/2/1:NaN)',
    'epubcfi(/6/6!/4/2/1:4junk)',
    'epubcfi(/6/6!/4/2[unterminated)',
    'epubcfi(/6/6!/4,/2)',
    'epubcfi(/6/6!/4,/2,/4,/6)',
  ])
    expect(parseSavedEPUBCFI({ href: 'chapter.xhtml', cfi })).toBeUndefined();

  for (const href of [
    '',
    '../book.xhtml',
    '%2e%2e/book.xhtml',
    '/book.xhtml',
    'https://x/book',
    'file:book',
    'book.xhtml#old',
    'book.xhtml?x=1',
    'bad%ZZ',
    'a\\b.xhtml',
  ])
    expect(parseSavedEPUBCFI({ href, cfi: 'epubcfi(/6/6!/4/2)' })).toBeUndefined();

  expect(parseSavedEPUBCFI(null)).toBeUndefined();
  expect(parseSavedEPUBCFI({ href: 5, cfi: 'epubcfi(/6/6!/4/2)' })).toBeUndefined();
  expect(
    savedEPUBCFI({
      href: 'chapter.xhtml',
      type: 'application/xhtml+xml',
      locations: { progression: 0.5 },
    }),
  ).toBeUndefined();
});
