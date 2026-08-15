import { Platform } from 'react-native';

export function resolveAPIBaseURL(
  configured: string | undefined,
  platform: string,
  configuredWeb?: string,
) {
  const value = (platform === 'web' && configuredWeb ? configuredWeb : configured)
    ?.trim()
    .replace(/\/+$/, '');
  return value || (platform === 'web' ? '' : 'http://localhost:8080');
}

export const apiBaseURL = resolveAPIBaseURL(
  process.env.EXPO_PUBLIC_API_URL,
  Platform.OS,
  process.env.EXPO_PUBLIC_WEB_API_URL,
);
