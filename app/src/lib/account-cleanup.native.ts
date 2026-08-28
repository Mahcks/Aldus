import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearToken } from './auth-token';
import { rememberUser } from './last-user';
import { clearStorageScope } from './storage-scope';
import { parseStoredJSON } from './stored-json';

type PendingCleanup = { origin: string; userID: string };
const key = 'aldus:pending-account-cleanups';

async function pending() {
  return parseStoredJSON<PendingCleanup[]>(await AsyncStorage.getItem(key)) ?? [];
}

export async function rememberAccountCleanup(origin: string, userID: string) {
  const records = await pending();
  if (!records.some((record) => record.origin === origin && record.userID === userID)) {
    await AsyncStorage.setItem(key, JSON.stringify([...records, { origin, userID }]));
  }
}

export async function finishAccountCleanup(origin: string, userID: string) {
  const records = (await pending()).filter(
    (record) => record.origin !== origin || record.userID !== userID,
  );
  if (records.length) await AsyncStorage.setItem(key, JSON.stringify(records));
  else await AsyncStorage.removeItem(key);
}

export async function retryAccountCleanups() {
  for (const record of await pending()) {
    try {
      await Promise.all([
        clearToken(record.origin),
        rememberUser(null, record.origin),
        clearStorageScope(record.origin, record.userID),
      ]);
      await finishAccountCleanup(record.origin, record.userID);
    } catch {
      // Retain the record until local storage is available again.
    }
  }
}
