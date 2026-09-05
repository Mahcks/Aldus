import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { getAPIBaseURL } from './api-base';
import { serverStoragePrefixes, serverStorageScope } from './server-origin';

let activeUserID = '';
const migratedKey = 'aldus:storage-v2-migrated';

export function setStorageUserID(userID: string) {
  const previous = activeStorageScope();
  activeUserID = userID;
  if (previous && previous !== activeStorageScope()) {
    void import('./native-download.native')
      .then(({ stopDownloads }) => stopDownloads(previous))
      .catch(() => {});
  }
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
  if (scope === activeStorageScope()) setStorageUserID('');
  const { stopOfflineDownloads } = await import('./offline-library.native');
  await stopOfflineDownloads(scope);
  const prefix = `aldus:${scope}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
  const filePrefix = `aldus-${encodeURIComponent(scope)}-`;
  for (const entry of Paths.document.list()) {
    if (entry instanceof File && entry.name.startsWith(filePrefix)) entry.delete();
  }
}

export async function clearServerStorage(origin: string) {
  if (origin === getAPIBaseURL()) setStorageUserID('');
  const { stopServerOfflineDownloads } = await import('./offline-library.native');
  await stopServerOfflineDownloads(origin);
  const prefixes = serverStoragePrefixes(origin);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefixes.storage));
  if (keys.length) await AsyncStorage.multiRemove(keys);
  for (const entry of Paths.document.list()) {
    if (entry instanceof File && entry.name.startsWith(prefixes.file)) entry.delete();
  }
}
