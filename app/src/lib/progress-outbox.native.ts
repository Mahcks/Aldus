import { createProgressOutbox } from './progress-outbox-shared';
import { updateOfflineProgress } from './offline-library.native';

export const {
  saveWorkProgress,
  reconcilePendingProgress,
  reconcileAllPendingProgress,
  pendingProgress,
  pendingProgressSnapshot,
  discardPendingProgress,
} = createProgressOutbox(updateOfflineProgress, async (scope) => scope);
