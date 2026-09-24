import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { AppIcon, type AppIconName } from './icons';
import { useThemeColors } from './theme';
import { Pressable, Text, View } from './tw';
import { resolvePressStateClass } from './Button';

/**
 * `shared` is a map of Tailwind className strings (not StyleSheet objects).
 * Screens still using the legacy `style={shared.x}` pattern need updating to
 * `className={shared.x}` when they're migrated to NativeWind in later phases.
 */
export const shared = {
  listItem: 'min-h-11 border-b border-line py-3.5 gap-1',
  itemTitle: 'text-base font-sans-bold text-ink',
  itemMeta: 'text-sm text-muted',
  form: 'max-w-[560px] gap-3',
  split: 'flex-row flex-wrap gap-6',
  grow: 'flex-grow basis-[360px]',
  mono: 'text-muted font-mono text-xs',
};

export function Row({ children }: PropsWithChildren) {
  return <View className="flex-row flex-wrap items-center gap-2">{children}</View>;
}

/**
 * Navigable list row for independently actionable objects (Libraries, and
 * similar collections outside the Work/book presentation in `bookshelf.tsx`):
 * an icon badge, title, optional subtitle, and a trailing chevron.
 */
export function IconRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: AppIconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-4 border-b border-line-subtle py-3.5 ${stateClass}`}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center">
          <AppIcon name={icon} size={18} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base font-sans-bold text-ink">
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="text-sm text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <AppIcon name="chevron" size={20} color={colors.subtle} />
    </Pressable>
  );
}

/**
 * A flat divider row, not `IconRow`'s bordered card — meant for a list of
 * actions inside a menu-style Dialog, where giving each row its own card
 * border would nest a card inside a card. Same icon-badge treatment as
 * IconRow for visual consistency without the nesting.
 */
export function ManagementRow({
  icon,
  label,
  onPress,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-3 border-b border-line-subtle py-3 ${stateClass}`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name={icon} size={18} color={colors.accent} />
      </View>
      <Text className="flex-1 text-base font-sans-semibold text-ink">{label}</Text>
      <AppIcon name="chevron" size={18} color={colors.subtle} />
    </Pressable>
  );
}

/**
 * The 44px floor exists for an action's tap target; a title on its own would
 * only gain dead space above and below itself, pushing it away from the
 * content it introduces.
 */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View
      className={`flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 ${action ? 'min-h-11' : ''}`}
    >
      <Text accessibilityRole="header" className="text-lg font-sans-bold text-ink">
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Section({
  title,
  action,
  children,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <View className="gap-2">
      <SectionHeader title={title} action={action} />
      {children}
    </View>
  );
}
