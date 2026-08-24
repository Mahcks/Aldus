import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../generated/api';
import { parseStoredJSON } from './stored-json';
import { getAPIBaseURL } from './api-base';

const key = 'aldus:last-users';

async function users() {
  const raw = await AsyncStorage.getItem(key);
  const value = parseStoredJSON<Record<string, User>>(raw);
  if (raw && !value) await AsyncStorage.removeItem(key);
  if (value) return value;
  const legacyRaw = await AsyncStorage.getItem('aldus:last-user');
  if (legacyRaw) await AsyncStorage.removeItem('aldus:last-user');
  return {};
}

export async function lastUser(origin = getAPIBaseURL()) {
  return (await users())[origin] ?? null;
}

export async function rememberUser(user: User | null, origin = getAPIBaseURL()) {
  const next = await users();
  if (user) next[origin] = user;
  else delete next[origin];
  await AsyncStorage.setItem(key, JSON.stringify(next));
}
