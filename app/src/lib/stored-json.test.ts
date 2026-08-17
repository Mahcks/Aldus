import { expect, test } from 'bun:test';
import { parseStoredJSON } from './stored-json';

test('stored JSON corruption falls back without breaking offline startup', () => {
  expect(parseStoredJSON<{ id: string }>(null)).toBeNull();
  expect(parseStoredJSON<{ id: string }>('not json')).toBeNull();
  expect(parseStoredJSON<{ id: string }>('{"id":"work-1"}')).toEqual({ id: 'work-1' });
});
