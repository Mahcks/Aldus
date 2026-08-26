import type { AudioSource } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { apiBaseURL, getAPIBaseURL } from './api-base';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';

const downloads = new Map<string, Promise<string>>();

export function mediaURL(name: string) {
  return `${apiBaseURL}/media/${name}`;
}

export function productMediaURL(id: string, origin = apiBaseURL) {
  return `${origin}/api/media/${encodeURIComponent(id)}`;
}

export async function productAudioSource(id: string, expectedSize?: number): Promise<AudioSource> {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const destination = new File(Paths.document, scopedMediaFileName(id, 'audio', scope));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) {
    return destination.uri;
  }
  if (destination.exists) destination.delete();
  const token = await getToken(origin);
  return {
    uri: productMediaURL(id, origin),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

export async function downloadProductAudio(id: string, expectedSize?: number) {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const destination = new File(Paths.document, scopedMediaFileName(id, 'audio', scope));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) {
    return destination.uri;
  }
  const pending = downloads.get(destination.uri);
  if (pending) return pending;
  const download = (async () => {
    const token = await getToken(origin);
    const downloaded = await File.downloadFileAsync(productMediaURL(id, origin), destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    });
    if (expectedSize && destination.size !== expectedSize) {
      if (destination.exists) destination.delete();
      throw new Error('The audiobook download was incomplete. Retry.');
    }
    return downloaded.uri;
  })();
  downloads.set(destination.uri, download);
  try {
    return await download;
  } finally {
    if (downloads.get(destination.uri) === download) downloads.delete(destination.uri);
  }
}
