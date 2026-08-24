import { Platform } from 'react-native';
import { developmentHost } from './development-host';

export function resolveAPIBaseURL(
  configured: string | undefined,
  platform: string,
  configuredWeb?: string,
  developmentHost?: string,
) {
  const value = (platform === 'web' ? configuredWeb : configured)?.trim().replace(/\/+$/, '');
  if (value || platform === 'web') return value || '';
  if (developmentHost) {
    try {
      const host = new URL(
        developmentHost.includes('://') ? developmentHost : `http://${developmentHost}`,
      ).hostname;
      if (host) return `http://${host}:8080`;
    } catch {
      // Fall through to the simulator default when Metro did not publish a valid host.
    }
  }
  return 'http://localhost:8080';
}

export let apiBaseURL = resolveAPIBaseURL(
  process.env.EXPO_PUBLIC_API_URL,
  Platform.OS,
  process.env.EXPO_PUBLIC_WEB_API_URL,
  developmentHost,
);

export const preloadedAPIBaseURL = process.env.EXPO_PUBLIC_API_URL?.trim() || '';

export function setAPIBaseURL(origin: string) {
  apiBaseURL = origin.replace(/\/+$/, '');
}

export function getAPIBaseURL() {
  return apiBaseURL;
}
