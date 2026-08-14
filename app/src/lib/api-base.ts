import { Platform } from 'react-native';

export function resolveAPIBaseURL(configured: string | undefined, platform: string) {
  const value = configured?.trim().replace(/\/+$/, '');
  return value || (platform === 'web' ? '' : 'http://localhost:8080');
}

export const apiBaseURL = resolveAPIBaseURL(process.env.EXPO_PUBLIC_API_URL, Platform.OS);
