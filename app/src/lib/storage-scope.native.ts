import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { getAPIBaseURL } from './api-base';
import { serverStorageScope } from './server-origin';

let activeUserID = '';
const migratedKey = 'aldus:storage-v2-migrated';

export function setStorageUserID(userID: string) {
  activeUserID = userID;
}

export function activeStorageScope() {
  const origin = getAPIBaseURL();
  return origin && activeUserID ? serverStorageScope(origin, activeUserID) : '';
}

export function scopedStorageKey(name: string, scope = activeStorageScope()) {
  if (!scope) throw new Error('No active Aldus account.');
  return `aldus:${scope}:${name}`;
}

export function scopedMediaFileName(id: string, extension: string, scope = activeStorageScope()) {
  if (!scope) throw new Error('No active Aldus account.');
  return `aldus-${encodeURIComponent(scope)}-${id}.${extension}`;
}

export async function prepareStorageScope(userID: string) {
  setStorageUserID(userID);
  if (!(await AsyncStorage.getItem(migratedKey))) {
    // Unscoped data cannot be safely attributed to a server; leave it inert instead of guessing.
    await AsyncStorage.setItem(migratedKey, '1');
  }
}

export async function clearStorageScope(origin: string, userID: string) {
  const scope = serverStorageScope(origin, userID);
  const prefix = `aldus:${scope}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
  const filePrefix = `aldus-${encodeURIComponent(scope)}-`;
  for (const entry of Paths.document.list()) {
    if (entry instanceof File && entry.name.startsWith(filePrefix)) entry.delete();
  }
}
