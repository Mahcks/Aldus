import { expect, test } from 'bun:test';
import { narratorNamesError, seriesPositionError } from './catalog-metadata';

test('catalog metadata accepts zero and exact decimals and explains invalid input', () => {
  for (const value of ['', '0', '1', '1.5', '999999.999'])
    expect(seriesPositionError(value)).toBe('');
  for (const value of ['-1', '1e3', 'NaN', '1.0001', '1000000'])
    expect(seriesPositionError(value)).not.toBe('');
  expect(narratorNamesError('Jane Doe\nJohn Smith')).toBe('');
  expect(narratorNamesError('Name\n'.repeat(21))).not.toBe('');
  expect(narratorNamesError('x'.repeat(201))).not.toBe('');
});
