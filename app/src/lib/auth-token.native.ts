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

let writes = Promise.resolve();

function updateTokens(update: (values: Record<string, string>) => void) {
  const result = writes.then(async () => {
    const values = await tokens();
    update(values);
    await SecureStore.setItemAsync(key, JSON.stringify(values));
  });
  writes = result.catch(() => {});
  return result;
}

export function setToken(token: string, origin = getAPIBaseURL()) {
  return updateTokens((values) => {
    values[origin] = token;
  });
}

export function clearToken(origin = getAPIBaseURL()) {
  return updateTokens((values) => {
    delete values[origin];
  });
}
