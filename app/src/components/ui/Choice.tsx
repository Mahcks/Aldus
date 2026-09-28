import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Platform } from 'react-native';
import { AppIcon } from './icons';
import { useThemeColors } from './theme';
import { Pressable, Text, View } from './tw';
import { Button, resolvePressStateClass } from './Button';
import { Dialog } from './Dialog';

type SelectProps = {
  label: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  /**
   * Show only the current choice in a field-style control that opens the full
   * list, for long option lists that would otherwise wrap into rows of chips.
   */
  menu?: boolean;
};

/** Accessible radiogroup of mutually-exclusive pill/chip choices. */
export function Select({ menu = false, ...props }: SelectProps) {
  if (menu) return <SelectMenu {...props} />;

  const { label, options, value, onChange, disabled = false } = props;
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap items-center gap-2"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            kind="secondary"
            disabled={disabled}
            selected={option.value === value}
            accessibilityRole="radio"
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function SelectMenu({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: Omit<SelectProps, 'menu'>) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? '';
  const borderClass = focused
    ? 'border border-focus outline outline-2 outline-focus'
    : 'border border-line-strong';

  function choose(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => setOpen(true)}
        className={`min-h-11 flex-row items-center gap-2 rounded-control bg-control px-3 py-2 ${borderClass} ${disabled ? 'opacity-50' : ''}`}
      >
        <Text numberOfLines={1} className="min-w-0 flex-1 text-base text-ink">
          {current}
        </Text>
        <AppIcon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
      <Dialog sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={label}>
          {options.map((option) => (
            <Radio
              key={option.value}
              label={option.label}
              selected={option.value === value}
              onPress={() => choose(option.value)}
            />
          ))}
        </View>
      </Dialog>
    </View>
  );
}

export function Checkbox({
  label,
  checked,
  onPress,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const webKeyboardProps =
    Platform.OS === 'web'
      ? {
          onKeyDown(event: ReactKeyboardEvent) {
            if (event.key !== ' ') return;
            event.preventDefault();
            if (!disabled && !event.repeat) onPress();
          },
        }
      : {};

  const boxClass = checked ? 'border-accent bg-accent' : 'border-line-strong bg-paper';
  const stateClass = disabled ? '' : resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      {...webKeyboardProps}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      aria-checked={checked}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-2 rounded-control ${stateClass} ${disabled ? 'opacity-50' : ''}`}
    >
      <View
        className={`h-6 w-6 shrink-0 items-center justify-center rounded-control border ${boxClass}`}
      >
        {checked ? <AppIcon name="check" size={16} color={colors.onAccent} /> : null}
      </View>
      <Text className={`min-w-0 flex-1 text-base ${disabled ? 'text-muted' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Single radio item, for custom radiogroups (role pickers, destination pickers, …). */
export function Radio({
  label,
  description,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  /** A second line under the label, read together with it. */
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const ringClass = selected ? 'border-accent' : 'border-line-strong';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      aria-checked={selected}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      {...(Platform.OS === 'web'
        ? {
            onKeyDown: (event: ReactKeyboardEvent) => {
              if (event.key === ' ') {
                event.preventDefault();
                if (!disabled && !event.repeat) onPress();
              }
            },
          }
        : {})}
      className={`min-h-11 flex-row items-center gap-2 rounded-control ${disabled ? 'opacity-50' : stateClass}`}
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-full border bg-paper ${ringClass}`}
      >
        {selected ? <View className="h-3 w-3 rounded-full bg-accent" /> : null}
      </View>
      <View className="min-w-0 flex-1 py-1">
        <Text className="text-base text-ink">{label}</Text>
        {description ? <Text className="text-sm text-muted">{description}</Text> : null}
      </View>
    </Pressable>
  );
}
