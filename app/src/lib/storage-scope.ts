import { getAPIBaseURL } from './api-base';
import { serverStorageScope } from './server-origin';

let activeUserID = '';

export function setStorageUserID(userID: string) {
  activeUserID = userID;
}

export async function prepareStorageScope(userID: string) {
  setStorageUserID(userID);
}

export async function clearStorageScope(_origin: string, _userID: string) {}

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
