/**
 * JS-side mirror of the CSS custom properties defined in `app/src/global.css`.
 * Use Tailwind utility classes (`bg-canvas`, `text-ink`, …) for styling;
 * only reach for this object when a color value is genuinely needed in JS,
 * e.g. an icon `color` prop or `ActivityIndicator` `color` prop that cannot
 * take a className.
 */
export const colors = {
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
