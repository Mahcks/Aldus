import { expect, mock, test } from 'bun:test';
mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
const storage = new Map<string, string>();
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));
const { rememberAccount, rememberedAccounts, forgetAccount, forgetServerAccounts } =
  await import('./remembered-accounts');

test('reader shortcuts retain only names and stay isolated by server', async () => {
  const user = { id: 'one', username: 'sam', display_name: 'Sam', token: 'never-store-this' };
  await Promise.all([
    rememberAccount(user, 'https://one.example'),
    rememberAccount({ id: 'two', username: 'lee', display_name: 'Lee' }, 'https://one.example'),
  ]);
  expect(await rememberedAccounts('https://one.example')).toHaveLength(2);
  expect(await rememberedAccounts('https://two.example')).toEqual([]);
  expect([...storage.values()].join('')).not.toContain('never-store-this');
  await rememberAccount(
    { id: 'two', username: 'new-lee', display_name: 'Lee' },
    'https://one.example',
  );
  expect((await rememberedAccounts('https://one.example'))[0].username).toBe('new-lee');
  await forgetAccount('one', 'https://one.example');
  expect((await rememberedAccounts('https://one.example')).map((item) => item.id)).toEqual(['two']);
  await forgetServerAccounts('https://one.example');
  expect(await rememberedAccounts('https://one.example')).toEqual([]);
});
