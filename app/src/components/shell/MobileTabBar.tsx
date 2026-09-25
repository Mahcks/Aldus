import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { resolvePressStateClass } from '@/components/ui';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { popIn, popOut } from '@/components/ui/motion';
import { useThemeColors } from '@/components/ui/theme';
import { AnimatedView, Pressable, Text, View } from '@/components/ui/tw';

export type MobileTabLink = { label: string; href: string; icon: AppIconName; badge?: number };

/** Mobile bottom tab bar: consumer destinations only, plus a "More" entry for everything else. */
export function MobileTabBar({
  links,
  isActive,
  bottomInset,
  sheetOpen,
  moreSelected,
  onOpenSheet,
}: {
  links: MobileTabLink[];
  isActive: (href: string) => boolean;
  bottomInset: number;
  sheetOpen: boolean;
  moreSelected: boolean;
  onOpenSheet: () => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      className="w-full flex-row justify-around border-t border-line-subtle bg-canvas px-2 pt-1.5"
      style={{ paddingBottom: bottomInset + 4 }}
    >
      {links.map((link) => (
        <MobileTab
          key={link.href}
          label={link.label}
          icon={link.icon}
          badge={link.badge}
          selected={isActive(link.href)}
          onPress={() => router.navigate(link.href as Href)}
        />
      ))}
      <MobileTab
        label="More"
        icon="more"
        selected={sheetOpen || moreSelected}
        expanded={sheetOpen}
        onPress={onOpenSheet}
      />
    </View>
  );
}

function MobileTab({
  label,
  icon,
  badge,
  selected,
  expanded,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  badge?: number;
  selected: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const color = selected ? colors.accent : colors.muted;
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const scale = useSharedValue(1);
  const previouslySelected = useRef(selected);

  useEffect(() => {
    if (selected && !previouslySelected.current) {
      scale.set(
        withSequence(
          withTiming(0.78, { duration: 90, reduceMotion: ReduceMotion.System }),
          withSpring(1, { damping: 8, stiffness: 320, reduceMotion: ReduceMotion.System }),
        ),
      );
    }

    previouslySelected.current = selected;
  }, [selected, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={badge ? `${label}, ${badge} unread updates` : label}
      accessibilityState={{ selected, expanded }}
      aria-selected={selected}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 min-w-11 flex-1 items-center justify-center gap-0.5 py-1 ${stateClass}`}
    >
      <Animated.View style={iconStyle}>
        <AppIcon name={icon} size={24} color={color} filled={selected} />
        {badge ? (
          <AnimatedView
            key="badge"
            entering={popIn}
            exiting={popOut}
            className="absolute -right-2.5 -top-1.5 h-[18px] min-w-[18px] items-center justify-center rounded-pill border-2 border-canvas bg-accent px-1"
          >
            <Text className="text-[10px] font-sans-bold leading-[12px] text-on-accent">
              {badge > 9 ? '9+' : badge}
            </Text>
          </AnimatedView>
        ) : null}
      </Animated.View>
      <Text className={`text-[10px] font-sans-medium ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
