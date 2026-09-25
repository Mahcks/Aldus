import { useRef, type PropsWithChildren } from 'react';
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
}: PropsWithChildren<{ danger?: boolean; tone?: Exclude<NoticeTone, 'neutral'> }>) {
  const colors = useThemeColors();
  const resolvedTone: NoticeTone = danger ? 'danger' : (tone ?? 'neutral');
  const style = NOTICE_STYLE[resolvedTone];
  const height = useSharedValue(0);
  const measured = useRef(false);

  const heightStyle = useAnimatedStyle(() => ({ height: height.get() }));

  function handleLayout(event: LayoutChangeEvent) {
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
    <AnimatedView className="overflow-hidden" style={heightStyle}>
      <View onLayout={handleLayout}>
        <AnimatedView
          entering={reveal}
          accessibilityRole={resolvedTone === 'danger' ? 'alert' : undefined}
          accessibilityLiveRegion={resolvedTone === 'danger' ? 'assertive' : 'polite'}
          className={`flex-row items-start gap-3 rounded-card border px-4 py-3 ${style.surface}`}
        >
          <View className="pt-0.5">
            <AppIcon name={style.icon} size={18} color={noticeIconColor(colors, resolvedTone)} />
          </View>
          <Text className="min-w-0 flex-1 text-sm leading-5 text-ink">{children}</Text>
        </AnimatedView>
      </View>
    </AnimatedView>
  );
}
