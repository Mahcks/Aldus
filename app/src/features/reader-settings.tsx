import { useState } from 'react';
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from '../components/EPUBReader';
import { colors } from './theme';
import { stepPreference } from './reader-settings-values';
import { Button, IconButton, resolvePressStateClass } from './ui';
import { Pressable, Text, View } from './tw';

type Props = {
  value: ReaderPreferences;
  resetValue?: ReaderPreferences;
  customized?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: ReaderPreferences) => void;
  onCustomizedChange?: (customized: boolean) => void;
};

const themes: {
  label: string;
  value: ReaderPreferences['theme'];
  background: string;
  ink: string;
}[] = [
  { label: 'Paper', value: 'paper', background: colors.paper, ink: colors.ink },
  { label: 'Warm', value: 'sepia', background: colors.canvas, ink: colors.ink },
  {
    label: 'Night',
    value: 'night',
    background: colors.readerNightPaper,
    ink: colors.readerNightInk,
  },
];

const fonts: { label: string; value: ReaderPreferences['fontFamily'] }[] = [
  { label: 'Publisher', value: 'publisher' },
  { label: 'Serif', value: 'serif' },
  { label: 'Sans', value: 'sans' },
  { label: 'OpenDyslexic', value: 'dyslexic' },
];

export function ReaderSettings({
  value,
  resetValue = DEFAULT_READER_PREFERENCES,
  customized = false,
  disabled,
  compact,
  onChange,
  onCustomizedChange,
}: Props) {
  const theme = themes.find((option) => option.value === value.theme) ?? themes[0];
  const changed =
    value.zoom !== resetValue.zoom ||
    value.lineHeight !== resetValue.lineHeight ||
    value.margin !== resetValue.margin ||
    value.theme !== resetValue.theme ||
    value.layout !== resetValue.layout ||
    value.fontFamily !== resetValue.fontFamily;

  return (
    <View className={compact ? 'gap-6 bg-raised' : 'border-b border-line bg-panel px-5 py-5'}>
      <View
        className={
          compact ? 'gap-6' : 'mx-auto w-full max-w-[960px] flex-row flex-wrap items-start gap-8'
        }
      >
        <View className={compact ? 'gap-2' : 'w-[300px] gap-2'}>
          <Text className="text-xs font-sans-bold uppercase tracking-wider text-muted">
            Preview
          </Text>
          <View
            className="min-h-[132px] justify-center overflow-hidden rounded-card border border-line px-5 py-4"
            style={{ backgroundColor: theme.background }}
          >
            <Text
              numberOfLines={3}
              className="font-reading"
              style={{
                color: theme.ink,
                fontSize: 17 * value.zoom,
                lineHeight: 17 * value.zoom * value.lineHeight,
                paddingHorizontal: value.margin * 3,
              }}
            >
              Alice opened the book and found the next page waiting exactly where she left it.
            </Text>
          </View>
          <Text className="text-xs text-muted">
            Changes apply to the open book and save automatically.
          </Text>
        </View>

        <View className={compact ? 'gap-6' : 'min-w-[420px] flex-1 gap-6'}>
          {onCustomizedChange ? (
            <View className="gap-3">
              <SectionTitle>Apply to</SectionTitle>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Reading settings scope"
                className="flex-row flex-wrap gap-2"
              >
                <Button
                  label="All books"
                  accessibilityRole="radio"
                  selected={!customized}
                  disabled={disabled}
                  onPress={() => onCustomizedChange(false)}
                />
                <Button
                  label="This book"
                  accessibilityRole="radio"
                  selected={customized}
                  disabled={disabled}
                  onPress={() => onCustomizedChange(true)}
                />
              </View>
              <Text className="text-xs leading-5 text-muted">
                {customized
                  ? 'Changes stay with this edition.'
                  : 'Changes become your default on every device.'}
              </Text>
            </View>
          ) : null}

          <View className="gap-2">
            <SectionTitle>Typography</SectionTitle>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Reader font"
              className="mb-2 flex-row flex-wrap gap-2"
            >
              {fonts.map((font) => (
                <Button
                  key={font.value}
                  label={font.label}
                  accessibilityRole="radio"
                  selected={value.fontFamily === font.value}
                  disabled={disabled}
                  onPress={() => onChange({ ...value, fontFamily: font.value })}
                />
              ))}
            </View>
            <Stepper
              label="Text size"
              value={`${Math.round(value.zoom * 100)}%`}
              disabled={disabled}
              decreaseDisabled={value.zoom <= 0.8}
              increaseDisabled={value.zoom >= 1.6}
              decreaseLabel="Make text smaller"
              increaseLabel="Make text larger"
              onDecrease={() =>
                onChange({ ...value, zoom: stepPreference(value.zoom, -0.1, 0.8, 1.6) })
              }
              onIncrease={() =>
                onChange({ ...value, zoom: stepPreference(value.zoom, 0.1, 0.8, 1.6) })
              }
            />
            <Stepper
              label="Line spacing"
              value={`${value.lineHeight.toFixed(1)}×`}
              disabled={disabled}
              decreaseDisabled={value.lineHeight <= 1.3}
              increaseDisabled={value.lineHeight >= 2.2}
              decreaseLabel="Reduce line spacing"
              increaseLabel="Increase line spacing"
              onDecrease={() =>
                onChange({
                  ...value,
                  lineHeight: stepPreference(value.lineHeight, -0.1, 1.3, 2.2),
                })
              }
              onIncrease={() =>
                onChange({
                  ...value,
                  lineHeight: stepPreference(value.lineHeight, 0.1, 1.3, 2.2),
                })
              }
            />
            <Stepper
              label="Side margins"
              value={marginLabel(value.margin)}
              disabled={disabled}
              decreaseDisabled={value.margin <= 0}
              increaseDisabled={value.margin >= 4}
              decreaseLabel="Widen the text area"
              increaseLabel="Narrow the text area"
              onDecrease={() =>
                onChange({ ...value, margin: stepPreference(value.margin, -0.5, 0, 4) })
              }
              onIncrease={() =>
                onChange({ ...value, margin: stepPreference(value.margin, 0.5, 0, 4) })
              }
            />
          </View>

          <View className="gap-3 border-t border-line pt-5">
            <SectionTitle>Page</SectionTitle>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Page color"
              className="flex-row gap-2"
            >
              {themes.map((option) => (
                <ThemeChoice
                  key={option.value}
                  label={option.label}
                  background={option.background}
                  selected={value.theme === option.value}
                  disabled={disabled}
                  onPress={() => onChange({ ...value, theme: option.value })}
                />
              ))}
            </View>
          </View>

          <View className="gap-3 border-t border-line pt-5">
            <SectionTitle>Reading flow</SectionTitle>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Reading flow"
              className="flex-row flex-wrap gap-2"
            >
              <Button
                label="Turn pages"
                icon="read"
                accessibilityRole="radio"
                selected={value.layout === 'paginated'}
                disabled={disabled}
                onPress={() => onChange({ ...value, layout: 'paginated' })}
              />
              <Button
                label="Continuous scroll"
                icon="scroll"
                accessibilityRole="radio"
                selected={value.layout === 'scrolled'}
                disabled={disabled}
                onPress={() => onChange({ ...value, layout: 'scrolled' })}
              />
            </View>
          </View>

          {changed ? (
            <View className="items-start border-t border-line pt-4">
              <Button
                label="Reset reading settings"
                icon="scan"
                kind="quiet"
                disabled={disabled}
                onPress={() => onChange(resetValue)}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text className="text-sm font-sans-bold text-ink">{children}</Text>;
}

function Stepper({
  label,
  value,
  disabled,
  decreaseDisabled,
  increaseDisabled,
  decreaseLabel,
  increaseLabel,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  decreaseDisabled: boolean;
  increaseDisabled: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View className="min-h-12 flex-row items-center gap-3 border-b border-line-subtle py-1 last:border-b-0">
      <Text className="min-w-0 flex-1 text-sm text-text-secondary">{label}</Text>
      <IconButton
        icon="decrease"
        label={decreaseLabel}
        kind="quiet"
        disabled={disabled || decreaseDisabled}
        onPress={onDecrease}
      />
      <Text className="w-16 text-center text-sm font-sans-semibold text-ink">{value}</Text>
      <IconButton
        icon="add"
        label={increaseLabel}
        kind="quiet"
        disabled={disabled || increaseDisabled}
        onPress={onIncrease}
      />
    </View>
  );
}

function ThemeChoice({
  label,
  background,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  background: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`will-change-variable min-h-16 flex-1 gap-1.5 rounded-control border p-1.5 ${
        selected ? 'border-accent bg-accent-soft' : 'border-line-strong bg-paper'
      } ${disabled ? 'opacity-50' : stateClass}`}
    >
      <View
        className="h-7 rounded-control border border-line"
        style={{ backgroundColor: background }}
      />
      <Text
        className={`text-center text-xs font-sans-semibold ${
          selected ? 'text-accent-strong' : 'text-text-secondary'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function marginLabel(margin: number) {
  if (margin <= 0.5) return 'Wide';
  if (margin <= 1.5) return 'Roomy';
  if (margin <= 2.5) return 'Balanced';
  if (margin <= 3.5) return 'Narrow';
  return 'Very narrow';
}
