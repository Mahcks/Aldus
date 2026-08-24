import * as SecureStore from 'expo-secure-store';
import { getAPIBaseURL } from './api-base';

const key = 'aldus.sessions';

async function tokens() {
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (stored) return JSON.parse(stored) as Record<string, string>;
    const legacy = await SecureStore.getItemAsync('aldus.session');
    if (legacy) {
      await SecureStore.deleteItemAsync('aldus.session');
    }
    return {};
  } catch {
    await SecureStore.deleteItemAsync(key);
    return {};
  }
}

export async function getToken(origin = getAPIBaseURL()) {
  return (await tokens())[origin] ?? null;
}

export async function setToken(token: string, origin = getAPIBaseURL()) {
  await SecureStore.setItemAsync(key, JSON.stringify({ ...(await tokens()), [origin]: token }));
}

export async function clearToken(origin = getAPIBaseURL()) {
  const next = await tokens();
  delete next[origin];
  await SecureStore.setItemAsync(key, JSON.stringify(next));
}
