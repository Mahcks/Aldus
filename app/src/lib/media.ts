import type { AudioSource } from 'expo-audio';
import { getToken } from './auth-token';
import { apiBaseURL } from './api-base';

export function mediaURL(name: string) {
  return `${apiBaseURL}/media/${name}`;
}

export function productMediaURL(id: string) {
  return `${apiBaseURL}/api/media/${encodeURIComponent(id)}`;
}

export async function productAudioSource(id: string): Promise<AudioSource> {
  const token = await getToken();
  return {
    uri: productMediaURL(id),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}
