import { useState } from 'react';
import { isKeyboardInput } from './Button';
import { AppIcon, type AppIconName } from './icons';
import { useThemeColors } from './theme';
import { Pressable, Text, View } from './tw';

/**
 * One row inside a `Popover`: a `menuitem` for actions, or an `option` for a
 * listbox choice. The popover moves focus between rows with the arrow keys,
 * so the focused row gets a background rather than an outline ring.
 */
export function MenuItem({
  label,
  onPress,
  icon,
  role = 'menuitem',
  selected = false,
  danger = false,
  submenu = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: AppIconName;
  role?: 'menuitem' | 'option';
  /** Marks the current choice of a listbox. */
  selected?: boolean;
  danger?: boolean;
  /** Shows a trailing chevron for an item that opens a further choice. */
  submenu?: boolean;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);

  // A menu opened by mouse focuses its first row for the arrow keys, but only
  // keyboard use should show that row as highlighted.
  const backgroundClass = resolveMenuItemBackgroundClass({
    selected,
    focused: focused && isKeyboardInput(),
  });
  const textClass = resolveMenuItemTextClass({ selected, danger });
  const iconColor = danger ? colors.danger : selected ? colors.accent : colors.muted;

  return (
    <Pressable
      role={role}
      accessibilityLabel={label}
      aria-selected={role === 'option' ? selected : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-3 rounded-control px-3 outline-none hover:bg-control ${backgroundClass} ${disabled ? 'opacity-50' : ''}`}
    >
      {role === 'option' ? (
        <View className="w-4 items-center">
          {selected ? <AppIcon name="check" size={16} color={colors.accent} /> : null}
        </View>
      ) : icon ? (
        <AppIcon name={icon} size={18} color={iconColor} />
      ) : null}
      <Text numberOfLines={1} className={`min-w-0 flex-1 text-base ${textClass}`}>
        {label}
      </Text>
      {submenu ? <AppIcon name="chevron" size={16} color={colors.subtle} /> : null}
    </Pressable>
  );
}

export function MenuSeparator() {
  return <View className="mx-1.5 my-1 h-px bg-line-subtle" />;
}

function resolveMenuItemBackgroundClass({
  selected,
  focused,
}: {
  selected: boolean;
  focused: boolean;
}) {
  if (selected) return 'bg-accent-soft';
  if (focused) return 'bg-control';
  return '';
}

function resolveMenuItemTextClass({ selected, danger }: { selected: boolean; danger: boolean }) {
  if (danger) return 'text-danger';
  if (selected) return 'font-sans-semibold text-accent-strong';
  return 'text-ink';
}
