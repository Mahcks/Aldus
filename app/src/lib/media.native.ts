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
  return `${origin}/api/v1/media/${encodeURIComponent(id)}`;
}

export function productAudioFileName(
  id: string,
  originalFilename?: string,
  scope = activeStorageScope(),
) {
  const extension = originalFilename?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ?? 'audio';
  return scopedMediaFileName(id, extension, scope);
}

export async function productAudioSource(
  id: string,
  expectedSize?: number,
  originalFilename?: string,
): Promise<AudioSource> {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const destination = new File(Paths.document, productAudioFileName(id, originalFilename, scope));
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

export async function downloadProductAudio(
  id: string,
  expectedSize?: number,
  originalFilename?: string,
) {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const destination = new File(Paths.document, productAudioFileName(id, originalFilename, scope));
  if (destination.exists && (!expectedSize || destination.size === expectedSize)) {
    return destination.uri;
  }
  const pending = downloads.get(destination.uri);
  if (pending) return pending;
  const download = (async () => {
    const temporary = new File(Paths.document, scopedMediaFileName(id, 'audio.part', scope));
    const temporaryURI = temporary.uri;
    if (temporary.exists) temporary.delete();
    const token = await getToken(origin);
    try {
      await File.downloadFileAsync(productMediaURL(id, origin), temporary, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        idempotent: false,
      });
      if (expectedSize && temporary.size !== expectedSize) {
        throw new Error('The audiobook download was incomplete. Retry.');
      }
      if (destination.exists) destination.delete();
      await temporary.move(destination);
      return destination.uri;
    } finally {
      const leftover = new File(temporaryURI);
      if (leftover.exists) leftover.delete();
    }
  })();
  downloads.set(destination.uri, download);
  try {
    return await download;
  } finally {
    if (downloads.get(destination.uri) === download) downloads.delete(destination.uri);
  }
}
