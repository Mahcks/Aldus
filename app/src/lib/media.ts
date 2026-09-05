import type { AudioSource } from 'expo-audio';
import { getToken } from './auth-token';
import { apiBaseURL } from './api-base';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';

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
  _expectedSize?: number,
  _originalFilename?: string,
): Promise<AudioSource> {
  const token = await getToken();
  return {
    uri: productMediaURL(id),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

export async function downloadProductAudio(
  id: string,
  expectedSize?: number,
  originalFilename?: string,
  _sha256?: string,
  _label?: string,
  _workID?: string,
) {
  return productAudioSource(id, expectedSize, originalFilename);
}
