import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@/generated/api';
import { getAPIBaseURL } from './api-base';
import { parseStoredJSON } from './stored-json';

type RememberedAccount = Pick<User, 'id' | 'username' | 'display_name'>;
const key = (origin: string) => `aldus:remembered-accounts:${encodeURIComponent(origin)}`;
let writes = Promise.resolve();

export async function rememberedAccounts(origin = getAPIBaseURL()): Promise<RememberedAccount[]> {
  const value = parseStoredJSON<unknown>(await AsyncStorage.getItem(key(origin)));
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RememberedAccount =>
      item &&
      typeof item.id === 'string' &&
      typeof item.username === 'string' &&
      typeof item.display_name === 'string',
  );
}

// Names only: selecting an account always requires a fresh password login.
export function rememberAccount(user: RememberedAccount, origin = getAPIBaseURL()) {
  const result = writes.then(async () => {
    const previous = await rememberedAccounts(origin);
    await AsyncStorage.setItem(
      key(origin),
      JSON.stringify([
        { id: user.id, username: user.username, display_name: user.display_name },
        ...previous.filter((item) => item.id !== user.id),
      ]),
    );
  });
  writes = result.catch(() => {});
  return result;
}

export function forgetAccount(id: string, origin = getAPIBaseURL()) {
  const result = writes.then(async () => {
    const values = await rememberedAccounts(origin);
    await AsyncStorage.setItem(
      key(origin),
      JSON.stringify(values.filter((item) => item.id !== id)),
    );
  });
  writes = result.catch(() => {});
  return result;
}

export function forgetServerAccounts(origin: string) {
  const result = writes.then(() => AsyncStorage.removeItem(key(origin)));
  writes = result.catch(() => {});
  return result;
}
