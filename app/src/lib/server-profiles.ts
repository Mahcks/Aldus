import type { ServerProfile } from './server-profile-types';

export type { ServerProfile } from './server-profile-types';

export async function loadServerProfiles(): Promise<{
  profiles: ServerProfile[];
  activeOrigin: string | null;
}> {
  return { profiles: [] as ServerProfile[], activeOrigin: '' };
}

export async function rememberServerProfile(_origin: string): Promise<ServerProfile[] | undefined> {
  return undefined;
}
