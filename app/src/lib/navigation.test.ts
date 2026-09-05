import { beforeEach, expect, mock, test } from 'bun:test';

let hasHistory = false;
const back = mock(() => {});
const replace = mock((_path: string) => {});
mock.module('expo-router', () => ({ router: { canGoBack: () => hasHistory, back, replace } }));
const { goBackOr, pageBackFallback } = await import('./navigation');

beforeEach(() => {
  hasHistory = false;
  back.mockClear();
  replace.mockClear();
});

test('Back preserves the actual origin when history exists', () => {
  hasHistory = true;
  goBackOr('/books');
  expect(back).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});

test('direct links replace themselves with their fallback', () => {
  goBackOr('/collections');
  expect(replace).toHaveBeenCalledWith('/collections');
  expect(back).not.toHaveBeenCalled();
});

test('nested pages have fallback destinations and primary pages do not', () => {
  expect(pageBackFallback('/work/book/manage')).toBe('/work/book');
  expect(pageBackFallback('/work/book')).toBe('/books');
  expect(pageBackFallback('/collection/list')).toBe('/collections');
  expect(pageBackFallback('/library/library')).toBe('/libraries');
  expect(pageBackFallback('/representation/file')).toBe('/libraries');
  expect(pageBackFallback('/catalog')).toBe('/books');
  expect(pageBackFallback('/account')).toBe('/home');
  expect(pageBackFallback('/collections')).toBe('/books');
  expect(pageBackFallback('/books')).toBeUndefined();
  expect(pageBackFallback('/search')).toBeUndefined();
  expect(pageBackFallback('/home')).toBeUndefined();
});
