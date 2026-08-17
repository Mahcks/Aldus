import type { AudioSource } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { apiBaseURL } from './api-base';

export function mediaURL(name: string) {
  return `${apiBaseURL}/media/${name}`;
}

export function productMediaURL(id: string) {
  return `${apiBaseURL}/api/media/${encodeURIComponent(id)}`;
}

export async function productAudioSource(id: string): Promise<AudioSource> {
  const destination = new File(Paths.document, `aldus-${id}.audio`);
  if (destination.exists) return destination.uri;
  const token = await getToken();
  return (
    await File.downloadFileAsync(productMediaURL(id), destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    })
  ).uri;
}
