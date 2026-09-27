import { expect, test } from 'bun:test';
import { readerSaveIndicator } from './reader-status';

test('idle and unavailable readers never claim a confirmed save', () => {
  expect(readerSaveIndicator('idle', true, false)).toBe('idle');
  for (const state of ['idle', 'saving', 'saved', 'offline', 'error'] as const) {
    expect(readerSaveIndicator(state, false, false)).toBe('paused');
  }
});

test('the current edition must settle before displaying the save outcome', () => {
  for (const state of ['idle', 'saving', 'saved', 'offline', 'error'] as const) {
    expect(readerSaveIndicator(state, true, true)).toBe('saving');
  }
  expect(readerSaveIndicator('saved', true, false)).toBe('saved');
  expect(readerSaveIndicator('offline', true, false)).toBe('on-device');
  expect(readerSaveIndicator('error', true, false)).toBe('error');
  expect(readerSaveIndicator('saving', true, false)).toBe('saving');
});

test('canonical success cannot hide a pending upload or failed edition save', () => {
  expect(readerSaveIndicator('saved', true, false, 'offline')).toBe('on-device');
  expect(readerSaveIndicator('saved', true, false, 'error')).toBe('error');
});
