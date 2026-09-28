import { useState } from 'react';
import { ActivityIndicator, Platform } from 'react-native';
import { AppIcon, type AppIconName } from './icons';
import { useThemeColors, type ThemeColors } from './theme';
import { Pressable, Text } from './tw';
import { useTooltip } from './tooltip';

/**
 * Web-only: RN Web fires `onFocus` for an ordinary mouse/touch click just as
 * much as for keyboard Tab navigation, with no way to tell them apart from
 * the focus event itself — unlike CSS `:focus-visible`, which the browser
 * resolves for us. Without this, every click left the 2px focus outline
 * sitting on whatever was clicked (a book cover, a nav link, a button) until
 * focus moved elsewhere, reading as a stray highlight rather than the
 * keyboard-navigation aid it's meant to be. Native platforms don't have this
 * problem — a touch tap there doesn't raise the same "focus" concept — so
 * this stays a web-only correction and native `focused` state is trusted as-is.
 */
let lastInputWasKeyboard = true;
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener('keydown', () => (lastInputWasKeyboard = true), true);
  document.addEventListener('pointerdown', () => (lastInputWasKeyboard = false), true);
}

/** Whether the most recent input was the keyboard rather than a pointer (always true off web). */
export function isKeyboardInput() {
  return lastInputWasKeyboard;
}

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
  if (focused && (Platform.OS !== 'web' || lastInputWasKeyboard))
    return 'border border-focus outline outline-2 outline-focus';
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
  if (focused && (Platform.OS !== 'web' || lastInputWasKeyboard))
    return 'outline outline-2 outline-focus';
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
  pressed: toggled,
  nativeID,
  size = 'default',
  menuExpanded,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  selected?: boolean;
  /** Marks a toggle button's on/off state for assistive tech (`aria-pressed` on web). */
  pressed?: boolean;
  /** Set when the button opens a menu: whether that menu is currently open. */
  menuExpanded?: boolean;
  nativeID?: string;
  /** `small` is only for pointer-revealed overlays, such as a book cover's hover menu. */
  size?: 'small' | 'default' | 'large';
}) {
  const colors = useThemeColors();
  const tooltip = useTooltip(label);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = (event: unknown) => {
    setFocused(true);
    if (lastInputWasKeyboard) tooltip.show(event, true);
  };
  const handleBlur = () => {
    setFocused(false);
    tooltip.hide();
  };
  const handlePressIn = () => {
    setPressed(true);
    tooltip.hide();
  };
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

  const sizeClass = {
    small: 'h-8 w-8 rounded-pill',
    default: 'h-11 w-11 rounded-control',
    large: 'h-16 w-16 rounded-pill',
  }[size];

  return (
    <Pressable
      nativeID={nativeID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      {...(toggled === undefined ? {} : ({ 'aria-pressed': toggled } as object))}
      {...(menuExpanded === undefined
        ? {}
        : ({ 'aria-haspopup': 'menu', 'aria-expanded': menuExpanded } as object))}
      disabled={disabled}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onHoverIn={(event) => tooltip.show(event)}
      onHoverOut={tooltip.hide}
      onPress={onPress}
      className={`transition-[transform,background-color] duration-150 motion-reduce:transition-none active:scale-[0.98] motion-reduce:active:scale-100 ${sizeClass} items-center justify-center ${backgroundClass} ${borderClass} ${shadowClass} ${opacityClass}`}
    >
      <AppIcon name={icon} size={{ small: 18, default: 20, large: 30 }[size]} color={iconColor} />
      {tooltip.tooltip}
    </Pressable>
  );
}
