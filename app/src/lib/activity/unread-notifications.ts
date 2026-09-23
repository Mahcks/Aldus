import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot() {
  return count;
}

function serverSnapshot() {
  return 0;
}

/**
 * Shared unread-notification count so the navigation badge and the Activity
 * screen read the same number and never drift apart. Both call
 * `setUnreadNotificationCount` after a successful fetch or mutation instead
 * of keeping independent local state.
 */
export function useUnreadNotificationCount(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function setUnreadNotificationCount(next: number | ((current: number) => number)) {
  const resolved = typeof next === 'function' ? next(count) : next;
  // Malformed input (a failed fetch's undefined body, NaN) keeps the last
  // known-good count rather than displaying a broken badge.
  if (!Number.isFinite(resolved)) return;
  count = Math.max(0, resolved);
  notify();
}
