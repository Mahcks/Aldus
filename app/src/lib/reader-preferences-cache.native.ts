import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReaderPreferences } from '@/generated/api';
import { parseStoredJSON } from './stored-json';
import { scopedStorageKey } from './storage-scope';

const key = () => scopedStorageKey('reader-preferences');

export async function cachedReaderPreferences() {
  return parseStoredJSON<ReaderPreferences>(await AsyncStorage.getItem(key()));
}

export async function cacheReaderPreferences(value: ReaderPreferences) {
  await AsyncStorage.setItem(key(), JSON.stringify(value));
}
