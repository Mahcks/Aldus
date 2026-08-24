import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ServerProfile } from './server-profile-types';

export type { ServerProfile } from './server-profile-types';

const profilesKey = 'aldus:servers';
const activeKey = 'aldus:active-server';

export async function loadServerProfiles() {
  const [storedProfiles, storedActive] = await Promise.all([
    AsyncStorage.getItem(profilesKey),
    AsyncStorage.getItem(activeKey),
  ]);
  let profiles: ServerProfile[] = [];
  try {
    const parsed: unknown = storedProfiles ? JSON.parse(storedProfiles) : [];
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.origin === 'string' &&
          typeof item.last_connected_at === 'string',
      )
    )
      profiles = parsed as ServerProfile[];
  } catch {
    await AsyncStorage.removeItem(profilesKey);
  }
  return {
    profiles,
    activeOrigin: profiles.some((item) => item.origin === storedActive) ? storedActive : null,
  };
}

export async function rememberServerProfile(origin: string) {
  const { profiles } = await loadServerProfiles();
  const next = [
    { origin, last_connected_at: new Date().toISOString() },
    ...profiles.filter((item) => item.origin !== origin),
  ];
  await Promise.all([
    AsyncStorage.setItem(profilesKey, JSON.stringify(next)),
    AsyncStorage.setItem(activeKey, origin),
  ]);
  return next;
}
