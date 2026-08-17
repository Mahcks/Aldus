import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../generated/api';
import { parseStoredJSON } from './stored-json';

const key = 'aldus:last-user';

export async function lastUser() {
  const raw = await AsyncStorage.getItem(key);
  const user = parseStoredJSON<User>(raw);
  if (raw && !user) await AsyncStorage.removeItem(key);
  return user;
}

export async function rememberUser(user: User | null) {
  if (user) await AsyncStorage.setItem(key, JSON.stringify(user));
  else await AsyncStorage.removeItem(key);
}
