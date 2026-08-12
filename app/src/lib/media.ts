import { Platform } from 'react-native';

const baseURL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'http://localhost:8080');

export function mediaURL(name: string) {
  return `${baseURL}/media/${name}`;
}
