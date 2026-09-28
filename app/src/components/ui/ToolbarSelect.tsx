import { useRef, useState } from 'react';
import { View as NativeView } from 'react-native';
import { resolvePressStateClass } from './Button';
import { AppIcon } from './icons';
import { MenuItem } from './MenuItem';
import { Popover } from './Popover';
import { useThemeColors } from './theme';
import { Pressable, Text } from './tw';

/**
 * A compact inline choice for a filter toolbar: shows "Label: Current" and
 * opens the options as a dropdown listbox.
 */
export function ToolbarSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const colors = useThemeColors();
  const anchorRef = useRef<NativeView>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? '';
  const stateClass = resolvePressStateClass({ focused, pressed: false });
  const borderClass = open ? 'border-focus bg-control-focus' : 'border-line-strong bg-control';

  function choose(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  return (
    <>
      <NativeView ref={anchorRef}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPress={() => setOpen((value) => !value)}
          className={`min-h-11 flex-row items-center gap-1.5 rounded-control border pl-3 pr-2.5 ${borderClass} ${stateClass}`}
        >
          <Text numberOfLines={1} className="text-sm text-muted">
            {label}:
          </Text>
          <Text numberOfLines={1} className="max-w-[220px] text-sm font-sans-semibold text-ink">
            {current}
          </Text>
          <AppIcon name={open ? 'chevronUp' : 'chevronDown'} size={16} color={colors.muted} />
        </Pressable>
      </NativeView>
      <Popover
        visible={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        label={label}
        role="listbox"
        minWidth={200}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            role="option"
            label={option.label}
            selected={option.value === value}
            onPress={() => choose(option.value)}
          />
        ))}
      </Popover>
    </>
  );
}
