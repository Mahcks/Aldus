import { useEffectiveScheme } from '@/lib/theme-preference';

/**
 * JS-side mirror of the CSS custom properties defined in `app/src/global.css`.
 * Use Tailwind utility classes (`bg-canvas`, `text-ink`, …) for styling;
 * only reach for these when a color value is genuinely needed in JS, e.g.
 * an icon `color` prop or `ActivityIndicator` `color` prop that cannot take
 * a className.
 *
 * Inside a component, prefer `useThemeColors()` over importing a palette
 * directly — it tracks the light/dark switch (system or user override) the
 * same way the CSS tokens do. Reach for `lightColors`/`darkColors` only
 * where a fixed value is genuinely wanted regardless of scheme.
 */
export const lightColors = {
  canvas: '#faf7f2',
  paper: '#fffdf8',
  panel: '#faf7f2',
  panelStrong: '#dfd3c3',

  ink: '#27211c',
  textSecondary: '#4a4038',
  muted: '#6c6258',
  subtle: '#75695e',

  line: 'rgba(39, 33, 28, 0.14)',
  lineStrong: '#908171',
  rail: '#2c241e',
  onRail: '#f6efe4',
  railMuted: '#c7b9aa',

  accent: '#8a3c24',
  accentStrong: '#6f2f1c',
  accentSoft: '#f1ded5',
  onAccent: '#fffdf8',

  danger: '#8a3028',
  dangerSoft: '#f6dfdb',
  focus: '#8a3c24',
  success: '#3f5c43',
  successSoft: '#e1e9df',
  warning: '#7a5a17',
  warningSoft: '#f3e6c8',
  info: '#3d5a73',
  infoSoft: '#dfe7ee',
  neutral: '#6c6258',
  neutralSoft: '#e7e0d4',

  readerNightPaper: '#171410',
  readerNightInk: '#eee6d8',
  readerNightSelection: '#5b3024',
};

/**
 * Dark twin of `lightColors` — see the `@media (prefers-color-scheme: dark)`
 * block in `global.css` for the token-by-token rationale (elevation steps
 * up from near-black instead of down from parchment, `onAccent` flips dark
 * since the accent fill itself flips bright, etc). Rail and reader-night
 * tokens are shared with light mode: the rail was already a dark strip,
 * and reader night-mode is a separate, book-local preference.
 */
export const darkColors: typeof lightColors = {
  canvas: '#171410',
  paper: '#211c17',
  panel: '#171410',
  panelStrong: '#3a2f24',

  ink: '#eee6d8',
  textSecondary: '#d9cdbb',
  muted: '#a89a86',
  subtle: '#8f8271',

  line: 'rgba(238, 230, 216, 0.14)',
  lineStrong: '#5c5040',
  rail: lightColors.rail,
  onRail: lightColors.onRail,
  railMuted: lightColors.railMuted,

  accent: '#d97a4c',
  accentStrong: '#c1673f',
  accentSoft: '#3a2418',
  onAccent: '#171410',

  danger: '#e26a5d',
  dangerSoft: '#3a1f1c',
  focus: '#d97a4c',
  success: '#6bab70',
  successSoft: '#22301f',
  warning: '#c99a3d',
  warningSoft: '#362b16',
  info: '#7fa8c9',
  infoSoft: '#1f2b34',
  neutral: '#a89a86',
  neutralSoft: '#2a251f',

  readerNightPaper: lightColors.readerNightPaper,
  readerNightInk: lightColors.readerNightInk,
  readerNightSelection: lightColors.readerNightSelection,
};

export type ThemeColors = typeof lightColors;

/** Reactive palette for the current color scheme — follows system/user dark mode. */
export function useThemeColors(): ThemeColors {
  const scheme = useEffectiveScheme();
  return scheme === 'dark' ? darkColors : lightColors;
}
