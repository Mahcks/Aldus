import { useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AppIcon, type AppIconName } from './icons';
import { EASE_STANDARD, reveal } from './motion';
import { useThemeColors, type ThemeColors } from './theme';
import { AnimatedView, Text, View } from './tw';

type NoticeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const NOTICE_STYLE: Record<NoticeTone, { surface: string; icon: AppIconName }> = {
  neutral: { surface: 'border-line-subtle bg-neutral-soft', icon: 'info' },
  info: { surface: 'border-info/25 bg-info-soft', icon: 'info' },
  warning: { surface: 'border-warning/25 bg-warning-soft', icon: 'warning' },
  success: { surface: 'border-success/25 bg-success-soft', icon: 'enabled' },
  danger: { surface: 'border-danger/25 bg-danger-soft', icon: 'error' },
};

function noticeIconColor(colors: ThemeColors, tone: NoticeTone) {
  return colors[tone];
}

/**
 * A short message about the page or a form: what went wrong, what changed, or
 * what to know. It opens its own space smoothly instead of popping in and
 * shoving the page down, and it carries an icon so tone never depends on color alone.
 */
export function Notice({
  children,
  danger,
  tone,
  title,
  icon,
  action,
  announcement,
}: PropsWithChildren<{
  danger?: boolean;
  tone?: Exclude<NoticeTone, 'neutral'>;
  /** A bold first line, for notices that need a headline before the explanation. */
  title?: string;
  /** Replaces the tone's default icon. */
  icon?: AppIconName;
  /** A button or link shown under the message. */
  action?: ReactNode;
  /** Interrupt screen-reader speech when an active interaction is stopped. */
  announcement?: 'polite' | 'assertive';
}>) {
  const colors = useThemeColors();
  const resolvedTone: NoticeTone = danger ? 'danger' : (tone ?? 'neutral');
  const style = NOTICE_STYLE[resolvedTone];
  const height = useSharedValue(0);
  const measured = useRef(false);
  // On native a notice shows at its natural height until it has measured itself once. Starting
  // collapsed there can leave it at zero height if the first measurement never arrives, and a
  // notice the user cannot see is worse than one that appears without an animated open.
  const [sizing, setSizing] = useState(Platform.OS === 'web');

  const heightStyle = useAnimatedStyle(() => ({ height: height.get() }));

  function handleLayout(event: LayoutChangeEvent) {
    if (!sizing) {
      height.set(event.nativeEvent.layout.height);
      measured.current = true;
      setSizing(true);
      return;
    }
    height.set(
      withTiming(event.nativeEvent.layout.height, {
        duration: measured.current ? 200 : 320,
        easing: EASE_STANDARD,
        reduceMotion: ReduceMotion.System,
      }),
    );
    measured.current = true;
  }

  return (
    <AnimatedView className="overflow-hidden" style={sizing ? heightStyle : undefined}>
      <View onLayout={handleLayout}>
        <AnimatedView
          entering={reveal}
          accessibilityRole={
            resolvedTone === 'danger' || announcement === 'assertive' ? 'alert' : undefined
          }
          accessibilityLiveRegion={
            announcement ?? (resolvedTone === 'danger' ? 'assertive' : 'polite')
          }
          className={`flex-row items-start gap-3 rounded-card border px-4 py-3 ${style.surface}`}
        >
          <View className="pt-0.5">
            <AppIcon
              name={icon ?? style.icon}
              size={18}
              color={noticeIconColor(colors, resolvedTone)}
            />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            {title ? <Text className="text-base font-sans-bold text-ink">{title}</Text> : null}
            <Text className="text-sm leading-5 text-ink">{children}</Text>
            {action ? <View className="pt-2 sm:items-start">{action}</View> : null}
          </View>
        </AnimatedView>
      </View>
    </AnimatedView>
  );
}
