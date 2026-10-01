import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { parseStoredJSON } from '@/lib/stored-json';

const storageKey = 'aldus:player-volume';

type PlayerVolume = {
  /** 0 to 1; 0 is muted. */
  level: number;
  /** The level to return to when unmuting. */
  lastAudible: number;
};

let volume: PlayerVolume = { level: 1, lastAudible: 1 };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function clamp(level: number) {
  return Math.min(1, Math.max(0, level));
}

// Static web export renders route modules in Node, where AsyncStorage's web
// backend has no `window` to read from — only load where storage exists.
if (typeof window !== 'undefined') {
  AsyncStorage.getItem(storageKey).then((raw) => {
    const saved = parseStoredJSON<PlayerVolume>(raw);
    if (typeof saved?.level !== 'number' || typeof saved.lastAudible !== 'number') return;
    volume = { level: clamp(saved.level), lastAudible: clamp(saved.lastAudible) || 1 };
    notify();
  });
}

function save(next: PlayerVolume) {
  volume = next;
  notify();
  void AsyncStorage.setItem(storageKey, JSON.stringify(next));
}

export function setPlayerVolume(level: number) {
  const next = clamp(level);
  save({ level: next, lastAudible: next > 0 ? next : volume.lastAudible });
}

export function togglePlayerMute() {
  save({ ...volume, level: volume.level > 0 ? 0 : volume.lastAudible });
}

/** Applies a volume level to an audio player (a mutable player object, like `applyPlaybackRate`). */
export function applyPlayerVolume(player: { volume: number }, level: number) {
  player.volume = level;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The listener's audiobook volume on this device, remembered between books. */
export function usePlayerVolume(): number {
  return useSyncExternalStore(
    subscribe,
    () => volume.level,
    () => 1,
  );
}
