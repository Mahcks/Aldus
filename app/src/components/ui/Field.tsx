import { useState } from 'react';
import { AppIcon } from './icons';
import { useThemeColors } from './theme';
import { Text, TextInput, View, type TextInputProps } from './tw';

function resolveFieldBorderClass({ focused, error }: { focused: boolean; error: boolean }) {
  if (focused) return 'border border-focus outline outline-2 outline-focus';
  if (error) return 'border border-danger';
  return 'border border-line-strong';
}

/** Inputs are inset — darker than their surroundings until focused, when they lift to paper. */
function resolveFieldBackgroundClass({ focused }: { focused: boolean }) {
  return focused ? 'bg-control-focus' : 'bg-control';
}

export function Field({
  label,
  help,
  error,
  ...props
}: TextInputProps & { label: string; help?: string; error?: string }) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);

  const handleBlur: TextInputProps['onBlur'] = (event) => {
    setFocused(false);
    props.onBlur?.(event);
  };

  const handleFocus: TextInputProps['onFocus'] = (event) => {
    setFocused(true);
    props.onFocus?.(event);
  };

  const borderClass = resolveFieldBorderClass({ focused, error: Boolean(error) });
  const backgroundClass = resolveFieldBackgroundClass({ focused });

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      {/*
        `text-base` carries a 24px line-height against a 16px font — fine for
        paragraph text, but on iOS a single-line TextInput doesn't distribute
        that extra leading evenly the way a Text node does; it pushes the
        glyphs toward the top of the box instead of centering them.
        `text-[16px]` below sets only the font size, no companion
        line-height, which is what actually centers it. Android has the
        opposite failure mode for the same "box taller than the text" setup —
        `textAlignVertical` (an Android-only prop, no-op on iOS) covers that
        side, and multiline fields stay top-aligned.
      */}
      <TextInput
        {...props}
        accessibilityLabel={label}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholderTextColor={colors.subtle}
        textAlignVertical={props.multiline ? 'top' : 'center'}
        className={`min-h-11 rounded-control px-3 py-2 text-[16px] text-ink outline-none ${backgroundClass} ${borderClass}`}
      />
      {error || help ? (
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}
        >
          {error || help}
        </Text>
      ) : null}
    </View>
  );
}

/** Same component as `Field`, exported under the name used by the design plan. */
export const TextField = Field;

/** Labeled search input with a leading search icon, for library search boxes. */
export function SearchField({
  label = 'Search',
  value,
  onChangeText,
  onSubmit,
  placeholder,
  hideLabel = false,
}: {
  hideLabel?: boolean;
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);

  const borderClass = resolveFieldBorderClass({ focused, error: false });
  const backgroundClass = resolveFieldBackgroundClass({ focused });

  return (
    <View className="gap-1.5">
      {hideLabel ? null : <Text className="text-sm font-sans-semibold text-ink">{label}</Text>}
      <View
        className={`min-h-11 flex-row items-center gap-2 rounded-control px-3 ${backgroundClass} ${borderClass}`}
      >
        <AppIcon name="search" size={18} color={colors.subtle} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.subtle}
          accessibilityLabel={label}
          returnKeyType="search"
          textAlignVertical="center"
          className="min-h-11 flex-1 py-2 text-[16px] text-ink outline-none"
        />
      </View>
    </View>
  );
}
