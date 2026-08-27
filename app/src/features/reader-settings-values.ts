import type {
  ReaderPreferences as ReaderPreferencesDTO,
  ReaderPreferencesUpdate,
  RepresentationState,
} from '../generated/api';

export type ReaderSettingsValue = {
  layout: 'paginated' | 'scrolled';
  zoom: number;
  lineHeight: number;
  margin: number;
  theme: 'paper' | 'sepia' | 'night';
  fontFamily: 'publisher' | 'serif' | 'sans' | 'dyslexic';
};

export function stepPreference(value: number, amount: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round((value + amount) * 100) / 100));
}

export function readerSettingsFromDTO(value: ReaderPreferencesDTO): ReaderSettingsValue {
  return {
    layout: value.reader_layout,
    zoom: value.zoom,
    lineHeight: value.line_height,
    margin: value.margin,
    theme: value.reader_theme,
    fontFamily: value.font_family,
  };
}

export function readerSettingsFromState(
  state: RepresentationState | null | undefined,
  defaults: ReaderSettingsValue,
): ReaderSettingsValue {
  if (!state?.reader_preferences_override) return defaults;
  return {
    layout: state.reader_layout ?? defaults.layout,
    zoom: state.zoom ?? defaults.zoom,
    lineHeight: state.line_height ?? defaults.lineHeight,
    margin: state.margin ?? defaults.margin,
    theme: state.reader_theme ?? defaults.theme,
    fontFamily: state.font_family ?? defaults.fontFamily,
  };
}

export function readerPreferencesUpdate(
  value: ReaderSettingsValue,
  expectedRevision: number,
): ReaderPreferencesUpdate {
  return {
    reader_layout: value.layout,
    zoom: value.zoom,
    line_height: value.lineHeight,
    margin: value.margin,
    reader_theme: value.theme,
    font_family: value.fontFamily,
    expected_revision: expectedRevision,
  };
}
