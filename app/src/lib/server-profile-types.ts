export type ServerProfile = { origin: string; last_connected_at: string };

export function removeInactiveServerProfile(
  profiles: ServerProfile[],
  activeOrigin: string | null,
  origin: string,
) {
  if (origin === activeOrigin) throw new Error('Switch libraries before forgetting this one.');
  return profiles.filter((item) => item.origin !== origin);
}
