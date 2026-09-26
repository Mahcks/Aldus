import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReadingOwnershipProof } from '@/generated/api';
import { activeStorageScope, scopedStorageKey } from '@/lib/storage-scope';

function cacheKey(workID: string) {
  const scope = activeStorageScope();
  return scope ? scopedStorageKey('reading-proof:' + workID, scope) : undefined;
}

// Only credentials actually confirmed by the server are cached. An offline
// reopen may keep using that epoch; it must never invent or upgrade one.
export async function cacheReadingProof(workID: string, proof: ReadingOwnershipProof) {
  const key = cacheKey(workID);
  if (key) await AsyncStorage.setItem(key, JSON.stringify(proof));
}

export async function cachedReadingProof(
  workID: string,
): Promise<ReadingOwnershipProof | undefined> {
  const key = cacheKey(workID);
  if (!key) return undefined;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (
      typeof value.device_id !== 'string' ||
      !value.device_id ||
      !Number.isSafeInteger(value.epoch) ||
      value.epoch <= 0
    )
      return undefined;
    return { device_id: value.device_id, epoch: value.epoch };
  } catch {
    return undefined;
  }
}
