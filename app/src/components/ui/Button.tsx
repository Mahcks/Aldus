import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { AppIcon, type AppIconName } from './icons';
import { useThemeColors, type ThemeColors } from './theme';
import { Pressable, Text } from './tw';

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'quiet';

function resolveButtonBackgroundClass({
  kind,
  selected,
  pressed,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  pressed: boolean;
  inactive: boolean;
}) {
  if (inactive && kind !== 'quiet') return 'bg-panel-strong';
  if (selected) return 'bg-accent-soft';
  if (kind === 'primary') return pressed ? 'bg-accent-strong' : 'bg-accent';
  if (kind === 'danger') return pressed ? 'bg-danger-soft' : 'bg-transparent';
  if (kind === 'quiet') return pressed ? 'bg-panel' : 'bg-transparent';
  return pressed ? 'bg-panel' : 'bg-paper';
}

function resolveButtonBorderClass({
  kind,
  selected,
  focused,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  focused: boolean;
  inactive: boolean;
}) {
  if (focused) return 'border border-focus outline outline-2 outline-focus';
  if (inactive && kind !== 'quiet') return 'border border-line-strong';
  if (selected) return 'border border-accent';
  if (kind === 'primary') return 'border border-accent';
  if (kind === 'danger') return 'border border-danger';
  if (kind === 'quiet') return 'border border-transparent';
  return 'border border-line-strong';
}

function resolveButtonTextClass({
  kind,
  selected,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  inactive: boolean;
}) {
  if (inactive && kind !== 'quiet') return 'text-subtle';
  if (selected) return 'text-accent-strong';
  if (kind === 'primary') return 'text-on-accent';
  if (kind === 'danger') return 'text-danger';
  if (kind === 'quiet') return 'text-accent';
  return 'text-ink';
}

function resolveButtonIconColor({
  kind,
  selected,
  inactive,
  colors,
}: {
  kind: ButtonKind;
  selected: boolean;
  inactive: boolean;
  colors: ThemeColors;
}) {
  if (inactive && kind !== 'quiet') return colors.subtle;
  if (selected) return colors.accentStrong;
  if (kind === 'primary') return colors.onAccent;
  if (kind === 'danger') return colors.danger;
  if (kind === 'quiet') return colors.accent;
  return colors.ink;
}

/**
 * Solid/outlined buttons get a soft lift so they read as physical controls
 * rather than flat HTML rectangles; `quiet` and `danger` stay flat by design
 * (quiet is meant to read as text, danger already reads via its red outline).
 * Radiogroup members (Select, filter chips, …) stay flat too — a shadow on
 * every pill in a row makes each one float individually instead of reading
 * as one connected control; the selected pill's accent border/fill already
 * carries the distinction.
 */
function resolveButtonShadowClass({
  kind,
  inactive,
  pressed,
  grouped,
}: {
  kind: ButtonKind;
  inactive: boolean;
  pressed: boolean;
  grouped: boolean;
}) {
  if (inactive || pressed || grouped) return '';
  if (kind === 'primary') return 'shadow-sm';
  if (kind === 'secondary') return '';
  return '';
}

/**
 * Generic press/focus feedback for plain `Pressable`-based controls that
 * don't go through `Button`/`IconButton` (nav links, tab bar items, custom
 * rows). Keeps every hand-rolled interactive element responding the same way.
 */
export function resolvePressStateClass({
  focused,
  pressed,
}: {
  focused: boolean;
  pressed: boolean;
}) {
  if (focused) return 'outline outline-2 outline-focus';
  if (pressed) return 'opacity-75';
  return '';
}

export function Button({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  selected = false,
  icon,
  iconOnly,
  loading,
  accessibilityRole = 'button',
  accessibilityLabel,
  expanded,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  selected?: boolean;
  icon?: AppIconName;
  iconOnly?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  expanded?: boolean;
  /** Override for use inside a radiogroup or tablist. */
  accessibilityRole?: 'button' | 'radio' | 'tab';
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const isInactive = Boolean(disabled || loading);
  const backgroundClass = resolveButtonBackgroundClass({
    kind,
    selected,
    pressed,
    inactive: isInactive,
  });
  const borderClass = resolveButtonBorderClass({ kind, selected, focused, inactive: isInactive });
  const textClass = resolveButtonTextClass({ kind, selected, inactive: isInactive });
  const iconColor = resolveButtonIconColor({ kind, selected, inactive: isInactive, colors });
  const shadowClass = resolveButtonShadowClass({
    kind,
    inactive: isInactive,
    pressed,
    grouped: accessibilityRole === 'radio' || accessibilityRole === 'tab',
  });
  const paddingClass = kind === 'quiet' ? 'px-2' : 'px-4';
  const inactiveClass = isInactive ? 'opacity-50' : '';

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      aria-expanded={expanded}
      aria-checked={accessibilityRole === 'radio' ? selected : undefined}
      accessibilityState={{
        disabled: isInactive,
        selected: accessibilityRole === 'radio' ? undefined : selected,
        checked: accessibilityRole === 'radio' ? selected : undefined,
        busy: loading,
        expanded,
      }}
      disabled={isInactive}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`min-h-11 max-w-full transition-[transform,background-color] duration-150 motion-reduce:transition-none active:scale-[0.98] motion-reduce:active:scale-100 flex-row items-center justify-center gap-2 rounded-control py-2.5 ${paddingClass} ${backgroundClass} ${borderClass} ${shadowClass} ${inactiveClass}`}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? colors.onAccent : colors.accent} />
      ) : (
        <>
          {icon ? <AppIcon name={icon} size={18} color={iconColor} /> : null}
          {iconOnly ? null : (
            <Text className={`min-w-0 shrink text-sm font-sans-semibold ${textClass}`}>
              {label}
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}

/**
 * Preferred primitive for icon-only actions. `label` is required and becomes
 * the accessibility label — prefer this over `Button`'s `iconOnly` prop,
 * which remains only for backward compatibility during the NativeWind
 * migration.
 */
export function IconButton({
  icon,
  label,
  onPress,
  kind = 'secondary',
  disabled,
  selected = false,
  nativeID,
  size = 'default',
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  selected?: boolean;
  nativeID?: string;
  size?: 'default' | 'large';
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const backgroundClass = resolveButtonBackgroundClass({
    kind,
    selected,
    pressed,
    inactive: Boolean(disabled),
  });
  const borderClass = resolveButtonBorderClass({
    kind,
    selected,
    focused,
    inactive: Boolean(disabled),
  });
  const iconColor = resolveButtonIconColor({
    kind,
    selected,
    inactive: Boolean(disabled),
    colors,
  });
  const shadowClass = resolveButtonShadowClass({
    kind,
    inactive: Boolean(disabled),
    pressed,
    grouped: false,
  });
  const opacityClass = disabled ? 'opacity-50' : '';

  const sizeClass = size === 'large' ? 'h-16 w-16 rounded-pill' : 'h-11 w-11 rounded-control';

  return (
    <Pressable
      nativeID={nativeID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`transition-[transform,background-color] duration-150 motion-reduce:transition-none active:scale-[0.98] motion-reduce:active:scale-100 ${sizeClass} items-center justify-center ${backgroundClass} ${borderClass} ${shadowClass} ${opacityClass}`}
    >
      <AppIcon name={icon} size={size === 'large' ? 30 : 20} color={iconColor} />
    </Pressable>
  );
}
