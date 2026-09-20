import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';
import { parseStoredJSON } from './stored-json';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

const storageKey = 'aldus:theme-preference';

let preference: ThemePreference = 'system';
let systemScheme: ColorScheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function effectiveScheme(): ColorScheme {
  return preference === 'system' ? systemScheme : preference;
}

/**
 * Pushes the current preference to wherever each platform actually reads
 * color scheme from.
 *
 * Native: `Appearance.setColorScheme` is the real, first-class RN API for
 * forcing a scheme app-wide — every consumer (NativeWind's CSS tokens,
 * `expo-status-bar`, native chrome) resolves against the same `Appearance`
 * state, so this one call is enough.
 *
 * Web: `react-native-web`'s `Appearance` has no `setColorScheme` (a real
 * browser also won't let JS fake `prefers-color-scheme` at all — only the
 * OS/browser can change it) — so global.css carries an explicit
 * `.theme-dark`/`.theme-light` class override alongside its
 * `@media (prefers-color-scheme: dark)` default, and this toggles that
 * class on `<html>` directly. "system" removes both classes and falls
 * back to the media query.
 */
function applyToPlatform() {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (preference !== 'system') root.classList.add(`theme-${preference}`);
    return;
  }
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

Appearance.addChangeListener(({ colorScheme }) => {
  systemScheme = colorScheme === 'dark' ? 'dark' : 'light';
  notify();
});

// Static web export renders every route module in Node, where AsyncStorage's
// web backend has no `window` to read from — only load where storage exists.
if (typeof window !== 'undefined') {
  AsyncStorage.getItem(storageKey).then((raw) => {
    const saved = parseStoredJSON<ThemePreference>(raw);
    if (saved !== 'light' && saved !== 'dark' && saved !== 'system') return;
    preference = saved;
    applyToPlatform();
    notify();
  });
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  applyToPlatform();
  notify();
  void AsyncStorage.setItem(storageKey, JSON.stringify(next));
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The user's raw System/Light/Dark choice, persisted — for the settings toggle. */
export function useThemePreference(): [ThemePreference, (value: ThemePreference) => void] {
  // The static-export HTML is always rendered as "system"/light; the client
  // re-reads the real snapshot right after hydration.
  const value = useSyncExternalStore(
    subscribe,
    () => preference,
    () => 'system' as ThemePreference,
  );
  return [value, setThemePreference];
}

/** The resolved light/dark scheme after applying the preference — for reading colors. */
export function useEffectiveScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, effectiveScheme, () => 'light' as ColorScheme);
}
