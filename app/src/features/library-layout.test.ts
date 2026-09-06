import { expect, test } from 'bun:test';
import { libraryColumns, libraryDensity } from './library-layout';

test('phone density defaults to two columns and compact uses three', () => {
  expect(libraryDensity(null)).toBe('comfortable');
  expect(libraryDensity('invalid')).toBe('comfortable');
  expect(libraryDensity('compact')).toBe('compact');
  expect(libraryColumns(390, 'comfortable')).toBe(2);
  expect(libraryColumns(390, 'compact')).toBe(3);
});

test('larger screens account for the navigation rail and bounded content width', () => {
  expect(libraryColumns(768, 'comfortable')).toBe(3);
  expect(libraryColumns(1024, 'comfortable')).toBe(3);
  expect(libraryColumns(1440, 'comfortable')).toBe(5);
  expect(libraryColumns(1440, 'compact')).toBe(8);
  expect(libraryColumns(2560, 'compact')).toBe(8);
});
