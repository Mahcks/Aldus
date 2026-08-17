import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../generated/api';

const key = 'aldus:last-user';

export async function lastUser() {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as User) : null;
}

export async function rememberUser(user: User | null) {
  if (user) await AsyncStorage.setItem(key, JSON.stringify(user));
  else await AsyncStorage.removeItem(key);
}
