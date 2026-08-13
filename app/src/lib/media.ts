import { Platform } from 'react-native';
import type { AudioSource } from 'expo-audio';
import { getToken } from './auth-token';

const baseURL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'http://localhost:8080');

export function mediaURL(name: string) {
  return `${baseURL}/media/${name}`;
}

export function productMediaURL(id: string) {
  return `${baseURL}/api/media/${encodeURIComponent(id)}`;
}

export async function productAudioSource(id: string): Promise<AudioSource> {
  const token = await getToken();
  return {
    uri: productMediaURL(id),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}
