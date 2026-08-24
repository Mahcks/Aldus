import type { AudioSource } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { apiBaseURL, getAPIBaseURL } from './api-base';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';

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
  if (destination.exists && (!expectedSize || destination.size === expectedSize))
    return destination.uri;
  const token = await getToken(origin);
  return (
    await File.downloadFileAsync(productMediaURL(id, origin), destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    })
  ).uri;
}
