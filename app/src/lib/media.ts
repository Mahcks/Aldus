import type { AudioSource } from 'expo-audio';
import { getToken } from './auth-token';
import { apiBaseURL } from './api-base';

export function mediaURL(name: string) {
  return `${apiBaseURL}/media/${name}`;
}

export function productMediaURL(id: string, origin = apiBaseURL) {
  return `${origin}/api/media/${encodeURIComponent(id)}`;
}

export async function productAudioSource(id: string, _expectedSize?: number): Promise<AudioSource> {
  const token = await getToken();
  return {
    uri: productMediaURL(id),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

export async function downloadProductAudio(id: string, expectedSize?: number) {
  return productAudioSource(id, expectedSize);
}
