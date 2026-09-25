import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { parseStoredJSON } from '@/lib/stored-json';

const storageKey = 'aldus:read-along';

// On by default: a synced book has always shown its text while listening.
let enabled = true;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

// Static web export renders route modules in Node, where AsyncStorage's web
// backend has no `window` to read from — only load where storage exists.
if (typeof window !== 'undefined') {
  AsyncStorage.getItem(storageKey).then((raw) => {
    const saved = parseStoredJSON<boolean>(raw);
    if (typeof saved !== 'boolean') return;
    enabled = saved;
    notify();
  });
}

export function setReadAlongEnabled(next: boolean) {
  enabled = next;
  notify();
  void AsyncStorage.setItem(storageKey, JSON.stringify(next));
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Whether the listener wants the text to follow the narration. A device preference, persisted. */
export function useReadAlongEnabled(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => enabled,
    () => true,
  );
  return [value, setReadAlongEnabled];
}
