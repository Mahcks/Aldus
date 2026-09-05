import type { AudioSource } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { apiBaseURL, getAPIBaseURL } from './api-base';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';

import { downloadNativeMedia } from './native-download.native';

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
  sha256?: string,
  label = 'Audiobook',
  workID?: string,
) {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  return downloadNativeMedia({
    id,
    origin,
    scope,
    sha256,
    expectedSize: expectedSize ?? 0,
    filename: productAudioFileName(id, originalFilename, scope),
    label,
    workID,
  });
}
