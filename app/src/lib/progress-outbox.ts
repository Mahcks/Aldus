import { createProgressOutbox } from './progress-outbox-shared';
import { getDeviceIdentity } from './device-identity';

export const {
  saveWorkProgress,
  reconcilePendingProgress,
  reconcileAllPendingProgress,
  pendingProgress,
  pendingProgressSnapshot,
  discardPendingProgress,
} = createProgressOutbox(
  async () => {},
  async (scope) => {
    const device = await getDeviceIdentity();
    return `${scope}:tab:${device.deviceID}`;
  },
);
