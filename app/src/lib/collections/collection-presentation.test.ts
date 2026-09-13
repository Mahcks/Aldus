import { describe, expect, test } from 'bun:test';
import { collectionCount, moveCollectionWork } from './collection-presentation';

describe('collection presentation', () => {
  test('uses readable book counts', () => {
    expect(collectionCount(0)).toBe('0 books');
    expect(collectionCount(1)).toBe('1 book');
  });

  test('moves one work without mutating the existing order', () => {
    const ids = ['one', 'two', 'three'];
    expect(moveCollectionWork(ids, 1, -1)).toEqual(['two', 'one', 'three']);
    expect(moveCollectionWork(ids, 1, 1)).toEqual(['one', 'three', 'two']);
    expect(ids).toEqual(['one', 'two', 'three']);
  });

  test('leaves boundary moves alone', () => {
    const ids = ['one', 'two'];
    expect(moveCollectionWork(ids, 0, -1)).toBe(ids);
    expect(moveCollectionWork(ids, 1, 1)).toBe(ids);
  });
});
