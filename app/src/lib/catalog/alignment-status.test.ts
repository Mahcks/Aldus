import { describe, expect, test } from 'bun:test';
import { alignmentJobHint } from './alignment-status';

describe('alignment failure recovery', () => {
  test.each([
    ['worker timeout', 'allow more time'],
    ['canceled', 'when you are ready'],
    [
      'GPU acceleration unavailable; check the NVIDIA driver and Docker GPU access',
      'CPU alignment',
    ],
    ['worker interrupted twice', 'server can stay running'],
    ['artifact validation failed', 'check the alignment logs'],
  ])('explains recovery for %s', (error, recovery) => {
    expect(alignmentJobHint({ state: 'failed', error })).toContain(recovery);
  });

  test('unknown failures never display raw worker output', () => {
    const error = 'Traceback: /private/server/path secret-value';
    const hint = alignmentJobHint({ state: 'failed', error });
    expect(hint).toContain('Retry sync');
    expect(hint).not.toContain(error);
    expect(alignmentJobHint({ state: 'failed' })).toBe(hint);
  });

  test('a historical error does not override the current job state', () => {
    const hint = alignmentJobHint({ state: 'ready', error: 'worker timeout' });
    expect(hint).toContain('Readers can switch');
    expect(hint).not.toContain('time limit');
  });
});
