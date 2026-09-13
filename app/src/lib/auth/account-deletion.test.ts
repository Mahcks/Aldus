import { describe, expect, mock, test } from 'bun:test';
import { deleteAccountAndClearState } from './account-deletion';

describe('deleteAccountAndClearState', () => {
  test('runs every cleanup and finalizes after a partial cleanup failure', async () => {
    const calls: string[] = [];
    const warn = console.warn;
    console.warn = mock(() => {});

    try {
      const cleaned = await deleteAccountAndClearState(
        async () => {
          calls.push('delete');
        },
        [
          async () => {
            calls.push('token');
            throw new Error('secure storage unavailable');
          },
          async () => {
            calls.push('user');
          },
          async () => {
            calls.push('storage');
          },
        ],
        () => {
          calls.push('finalize');
        },
      );
      expect(cleaned).toBe(false);
    } finally {
      console.warn = warn;
    }

    expect(calls[0]).toBe('delete');
    expect(calls.slice(1, 4).sort()).toEqual(['storage', 'token', 'user']);
    expect(calls[4]).toBe('finalize');
  });

  test('reports complete local cleanup', async () => {
    const cleaned = await deleteAccountAndClearState(
      async () => {},
      [async () => {}],
      () => {},
    );
    expect(cleaned).toBe(true);
  });

  test('does not clean up or finalize when server deletion fails', async () => {
    const calls: string[] = [];

    await expect(
      deleteAccountAndClearState(
        async () => {
          throw new Error('request failed');
        },
        [async () => calls.push('cleanup')],
        () => calls.push('finalize'),
      ),
    ).rejects.toThrow('request failed');

    expect(calls).toEqual([]);
  });
});
