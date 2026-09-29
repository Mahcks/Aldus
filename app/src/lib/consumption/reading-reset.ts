import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReadingClaim } from '@/generated/api';
import { getDeviceIdentity } from '@/lib/device-identity';
import { activeStorageScope, scopedStorageKey } from '@/lib/storage-scope';
import { discardPendingProgress } from '@/lib/progress-outbox';
import { resetOfflineReadingState } from '@/lib/offline-library';
import { rememberReadingConflict } from './reading-conflict';
import { serializeEditionSave } from './offline-representation';

/** Adopt an explicit reset before loading or replaying this device's old places. */
export async function applyReadingReset(workID: string, snapshot: ReadingClaim) {
  const epoch = snapshot.reset_epoch ?? 0;
  if (!epoch) return;
  const scope = activeStorageScope();
  const device = await getDeviceIdentity();
  const key = scopedStorageKey(`reading-reset:${device.deviceID}:${workID}`, scope);
  await serializeEditionSave(workID, async () => {
    if (Number(await AsyncStorage.getItem(key)) >= epoch) return;
    if (!scope || scope !== activeStorageScope()) throw new Error('The active account changed.');
    await discardPendingProgress(workID, scope);
    await resetOfflineReadingState(workID, snapshot, scope);
    await rememberReadingConflict(workID, 'progress', undefined, scope);
    await rememberReadingConflict(workID, 'edition', undefined, scope);
    // Mark last: a storage failure leaves the reset retryable before reading resumes.
    await AsyncStorage.setItem(key, String(epoch));
  });
}
