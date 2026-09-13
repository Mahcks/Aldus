import { describe, expect, test } from 'bun:test';
import {
  readerPreferencesUpdate,
  readerSettingsFromDTO,
  readerSettingsFromState,
  stepPreference,
  type ReaderSettingsValue,
} from './reader-settings-values';

const defaults: ReaderSettingsValue = {
  layout: 'paginated',
  zoom: 1,
  lineHeight: 1.72,
  margin: 2,
  theme: 'paper',
  fontFamily: 'serif',
};

describe('reader preference steps', () => {
  test('rounds increments and stops at both bounds', () => {
    expect(stepPreference(1, 0.1, 0.8, 1.6)).toBe(1.1);
    expect(stepPreference(0.8, -0.1, 0.8, 1.6)).toBe(0.8);
    expect(stepPreference(1.6, 0.1, 0.8, 1.6)).toBe(1.6);
  });
});

describe('reader preference scope', () => {
  test('uses defaults until the current edition enables an override', () => {
    expect(
      readerSettingsFromState(
        {
          representation_id: 'epub',
          reader_theme: 'night',
          reader_preferences_override: false,
          revision: 1,
          updated_at: '2026-08-27T00:00:00Z',
        },
        defaults,
      ),
    ).toEqual(defaults);
    expect(
      readerSettingsFromState(
        {
          representation_id: 'epub',
          reader_theme: 'night',
          font_family: 'dyslexic',
          reader_preferences_override: true,
          revision: 2,
          updated_at: '2026-08-27T00:00:00Z',
        },
        defaults,
      ),
    ).toEqual({ ...defaults, theme: 'night', fontFamily: 'dyslexic' });
  });

  test('maps the public contract in both directions', () => {
    const dto = {
      reader_layout: 'scrolled' as const,
      zoom: 1.2,
      line_height: 1.9,
      margin: 1,
      reader_theme: 'sepia' as const,
      font_family: 'sans' as const,
      revision: 4,
    };
    const value = readerSettingsFromDTO(dto);
    expect(readerPreferencesUpdate(value, dto.revision)).toEqual({
      reader_layout: 'scrolled',
      zoom: 1.2,
      line_height: 1.9,
      margin: 1,
      reader_theme: 'sepia',
      font_family: 'sans',
      expected_revision: 4,
    });
  });
});
