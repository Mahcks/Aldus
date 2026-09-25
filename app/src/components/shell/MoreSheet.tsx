import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, PanResponder, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { resolvePressStateClass } from '@/components/ui';
import { sheetEnter, sheetExit } from '@/components/ui/motion';
import { useThemeColors } from '@/components/ui/theme';
import { Pressable, ScrollView, Text, View } from '@/components/ui/tw';

export type MoreSheetLink = { label: string; href: string; icon: AppIconName };

const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.9;

/**
 * Bottom sheet for everything the mobile tab bar has no room for: admin
 * destinations and the account. Shaped like a native iOS sheet: a grabber, a
 * large corner radius, grouped inset rows with icon tiles, "Done" instead of
 * a close icon, and drag-down-to-dismiss. Colors and type stay Aldus.
 */
export function MoreSheet({
  visible,
  onClose,
  isActive,
  adminLinks,
  userLabel,
  onSignOut,
  bottomInset,
}: {
  visible: boolean;
  onClose: () => void;
  isActive: (href: string) => boolean;
  adminLinks: MoreSheetLink[];
  userLabel: string;
  onSignOut: () => void;
  bottomInset: number;
}) {
  const translateY = useSharedValue(0);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) translateY.set(0);
  }, [visible, translateY]);
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && gesture.dy > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          translateY.set(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            onClose();
            translateY.set(0);
            return;
          }

          translateY.set(withSpring(0, { damping: 22, stiffness: 260 }));
        },
        onPanResponderTerminate: () => {
          translateY.set(withTiming(0, { duration: 180 }));
        },
      }),
    [onClose, translateY],
  );

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  if (!visible) return null;

  function handleLinkPress(href: string) {
    onClose();
    router.navigate(href as Href);
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-ink/40">
        <Pressable
          accessibilityLabel="Dismiss menu"
          accessibilityRole="button"
          onPress={onClose}
          className="absolute inset-0"
        />
        <Animated.View entering={sheetEnter} exiting={sheetExit}>
          <Animated.View style={dragStyle}>
            <View
              accessibilityViewIsModal
              role="dialog"
              accessibilityLabel="More"
              className="rounded-t-[28px] bg-canvas px-4 pt-2.5"
              style={{ paddingBottom: bottomInset + 16, maxHeight: height - insets.top - 16 }}
            >
              <View {...dragResponder.panHandlers}>
                <View
                  pointerEvents="none"
                  className="mb-1 h-1.5 w-10 self-center rounded-pill bg-line-strong/50"
                />
                <View className="flex-row items-center justify-between px-1 pb-3 pt-1">
                  <Text accessibilityRole="header" className="text-xl font-sans-bold text-ink">
                    More
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close menu"
                    onPress={onClose}
                    className="min-h-11 min-w-11 items-end justify-center"
                  >
                    <Text className="text-base font-sans-bold text-accent">Done</Text>
                  </Pressable>
                </View>
              </View>

              <ScrollView className="shrink" contentContainerClassName="gap-5">
                {adminLinks.length > 0 ? (
                  <Group title="Administration">
                    {adminLinks.map((link, index) => (
                      <SheetRow
                        key={link.href}
                        label={link.label}
                        icon={link.icon}
                        selected={isActive(link.href)}
                        separated={index > 0}
                        onPress={() => handleLinkPress(link.href)}
                      />
                    ))}
                  </Group>
                ) : null}

                <Group title="Account">
                  <SheetRow
                    label={userLabel || 'Account'}
                    icon="account"
                    selected={isActive('/account')}
                    onPress={() => handleLinkPress('/account')}
                  />
                </Group>

                <Group>
                  <Pressable
                    accessibilityRole="button"
                    onPress={onSignOut}
                    className="min-h-12 items-center justify-center px-4"
                  >
                    <Text className="text-base font-sans-medium text-accent">Sign out</Text>
                  </Pressable>
                </Group>
              </ScrollView>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      {title ? <Text className="px-4 text-xs font-sans-bold text-muted">{title}</Text> : null}
      <View className="overflow-hidden rounded-card border border-line-subtle bg-paper">
        {children}
      </View>
    </View>
  );
}

function SheetRow({
  label,
  icon,
  selected,
  separated = false,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  selected: boolean;
  separated?: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const focusClass = resolvePressStateClass({ focused, pressed: false });
  const pressedClass = pressed ? 'bg-line-subtle' : '';

  return (
    <>
      {separated ? <View className="ml-[56px] h-px bg-line-subtle" /> : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        aria-current={selected ? 'page' : undefined}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={onPress}
        className={`min-h-12 flex-row items-center gap-3 px-4 py-2 -outline-offset-2 ${pressedClass} ${focusClass}`}
      >
        <View
          className={`h-8 w-8 items-center justify-center rounded-[9px] ${selected ? 'bg-accent' : 'bg-accent-soft'}`}
        >
          <AppIcon name={icon} size={18} color={selected ? colors.onAccent : colors.accent} />
        </View>
        <Text
          numberOfLines={1}
          className={`min-w-0 flex-1 text-base ${selected ? 'font-sans-bold text-ink' : 'font-sans-medium text-ink'}`}
        >
          {label}
        </Text>
        <AppIcon name="chevron" size={18} color={colors.subtle} />
      </Pressable>
    </>
  );
}
