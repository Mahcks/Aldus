import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { resolvePressStateClass } from '@/components/ui';
import { AppIcon } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Pressable, View } from '@/components/ui/tw';

type Mode = 'read' | 'listen';

export function PassageHandoff({
  mode,
  busy,
  synchronized,
  onPress,
}: {
  mode: Mode;
  busy: boolean;
  synchronized: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const listeningNext = mode === 'read';
  const label = listeningNext ? 'Switch to listening' : 'Switch to reading';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        synchronized
          ? 'Keeps your synchronized place'
          : 'Opens the other format at its saved position'
      }
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`will-change-variable h-11 w-14 flex-row items-center justify-center gap-0.5 rounded-control ${
        busy ? 'opacity-50' : stateClass
      }`}
    >
      <AppIcon name={listeningNext ? 'read' : 'listen'} size={14} color={colors.muted} />
      <View className="w-2.5 items-center justify-center">
        <AppIcon name={synchronized ? 'synced' : 'chevron'} size={11} color={colors.subtle} />
      </View>
      <View className="h-7 w-7 items-center justify-center rounded-pill bg-accent-soft">
        {busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <AppIcon name={listeningNext ? 'listen' : 'read'} size={19} color={colors.accent} />
        )}
      </View>
    </Pressable>
  );
}
