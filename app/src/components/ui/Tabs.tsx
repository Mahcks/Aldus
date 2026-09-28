import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Platform } from 'react-native';
import { resolvePressStateClass } from './Button';
import { Pressable, Text, View } from './tw';

type TabOption<T extends string> = { value: T; label: string };

/**
 * A row of tabs that filters the content below it. Left and Right arrows move
 * between tabs on web, the way a browser tab strip works.
 */
export function Tabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const tabs = [
      ...(event.currentTarget as unknown as HTMLElement).querySelectorAll<HTMLElement>(
        '[role="tab"]',
      ),
    ];
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    tabs[(current + step + tabs.length) % tabs.length]?.focus();
  }

  return (
    <View
      role="tablist"
      aria-label={label}
      {...(Platform.OS === 'web' ? ({ onKeyDown: handleKeyDown } as object) : {})}
      className="flex-row flex-wrap border-b border-line"
    >
      {options.map((option) => (
        <Tab
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function Tab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed: false });
  const selectedClass = selected ? 'border-accent' : 'border-transparent hover:border-line-strong';

  return (
    <Pressable
      role="tab"
      accessibilityLabel={label}
      aria-selected={selected}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      className={`-mb-px min-h-11 justify-center rounded-t-control border-b-2 px-3.5 ${selectedClass} ${stateClass}`}
    >
      <Text
        className={`text-sm ${selected ? 'font-sans-semibold text-ink' : 'font-sans-medium text-muted'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
