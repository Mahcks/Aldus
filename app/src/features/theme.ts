/**
 * JS-side mirror of the CSS custom properties defined in `app/src/global.css`.
 * Use Tailwind utility classes (`bg-canvas`, `text-ink`, …) for styling;
 * only reach for this object when a color value is genuinely needed in JS,
 * e.g. an icon `color` prop or `ActivityIndicator` `color` prop that cannot
 * take a className.
 */
export const colors = {
  canvas: '#f4efe6',
  paper: '#fffdf8',
  panel: '#ece4d8',
  panelStrong: '#dfd3c3',

  ink: '#27211c',
  muted: '#5f564c',
  subtle: '#85796c',

  line: '#cbbfb0',
  lineStrong: '#a99c8a',

  accent: '#8a3c24',
  accentStrong: '#6f2f1c',
  accentSoft: '#f1ded5',
  onAccent: '#fffdf8',

  danger: '#8a3028',
  dangerSoft: '#f6dfdb',
  focus: '#bd6a4e',
  success: '#3f5c43',
  successSoft: '#e1e9df',
  warning: '#7a5a17',
  warningSoft: '#f3e6c8',
  info: '#3d5a73',
  infoSoft: '#dfe7ee',
  neutral: '#6c6258',
  neutralSoft: '#e7e0d4',
};
