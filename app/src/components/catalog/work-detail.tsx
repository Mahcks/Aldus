import { useEffect, useState, type ReactNode } from 'react';
import { resolvePressStateClass } from '@/components/ui';
import { AppIcon } from '@/components/ui/icons';
import { EASE_STANDARD, sectionFade } from '@/components/ui/motion';
import { useThemeColors } from '@/components/ui/theme';
import { AnimatedView, Pressable, Text, View } from '@/components/ui/tw';
import {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** A titled block of the book page that eases in after the hero, one after another. */
export function DetailSection({
  index,
  title,
  children,
}: {
  index: number;
  title?: string;
  children: ReactNode;
}) {
  return (
    <AnimatedView entering={sectionFade(index)} className="gap-3">
      {title ? (
        <Text accessibilityRole="header" className="text-lg font-sans-semibold text-ink">
          {title}
        </Text>
      ) : null}
      {children}
    </AnimatedView>
  );
}

/** Reading or listening progress: a bar that fills to the saved position, with a plain-language line under it. */
export function ProgressMeter({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.set(
      withTiming(clamped / 100, {
        duration: 700,
        easing: EASE_STANDARD,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [clamped, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: fill.get() }],
  }));

  return (
    <View className="w-full gap-2">
      {clamped > 0 ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: clamped }}
          className="h-1.5 overflow-hidden rounded-pill bg-line"
        >
          <AnimatedView
            className="h-full w-full bg-accent-strong"
            style={[{ transformOrigin: 'left center' }, fillStyle]}
          />
        </View>
      ) : null}
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}

export type DetailTabKey = 'about' | 'details' | 'editions';

/** Underlined tabs for the phone layout: About, Details and Editions share one panel. */
export function DetailTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: DetailTabKey; label: string }[];
  active: DetailTabKey;
  onChange: (key: DetailTabKey) => void;
}) {
  return (
    <View accessibilityRole="tablist" className="flex-row gap-6 border-b border-line">
      {tabs.map((tab) => (
        <DetailTab
          key={tab.key}
          label={tab.label}
          selected={tab.key === active}
          onPress={() => onChange(tab.key)}
        />
      ))}
    </View>
  );
}

function DetailTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      aria-selected={selected}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`-mb-px min-h-11 justify-center border-b-2 px-0.5 ${selected ? 'border-accent' : 'border-transparent'} ${stateClass}`}
    >
      <Text className={`text-[15px] font-sans-semibold ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export type DetailFact = {
  label: string;
  value: string;
  onPress?: () => void;
};

/** Grouped label/value list, like iOS Settings: rows share one rounded surface with hairline dividers. */
export function DetailFacts({ facts }: { facts: DetailFact[] }) {
  if (facts.length === 0) return null;

  return (
    <View className="overflow-hidden rounded-card border border-line-subtle bg-paper">
      {facts.map((fact, index) => (
        <DetailFactRow key={`${fact.label}-${fact.value}`} fact={fact} separated={index > 0} />
      ))}
    </View>
  );
}

function DetailFactRow({ fact, separated }: { fact: DetailFact; separated: boolean }) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const focusClass = resolvePressStateClass({ focused, pressed: false });
  const borderClass = separated ? 'border-t border-line-subtle' : '';
  const rowClass = `min-h-12 flex-row items-center gap-3 px-4 py-3 ${borderClass}`;

  const content = (
    <>
      <Text className="w-[104px] shrink-0 text-sm text-muted">{fact.label}</Text>
      <Text selectable={!fact.onPress} className="min-w-0 flex-1 text-sm text-ink">
        {fact.value}
      </Text>
      {fact.onPress ? <AppIcon name="chevron" size={16} color={colors.subtle} /> : null}
    </>
  );

  if (!fact.onPress) return <View className={rowClass}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${fact.label}: ${fact.value}`}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={fact.onPress}
      className={`${rowClass} -outline-offset-2 ${pressed ? 'bg-line-subtle' : ''} ${focusClass}`}
    >
      {content}
    </Pressable>
  );
}

/** A one-line, plain-language explanation of how reading and listening progress relate for this book. */
export function SyncNote({ text }: { text: string }) {
  const colors = useThemeColors();

  return (
    <View className="max-w-md flex-row items-start gap-2">
      <View className="pt-0.5">
        <AppIcon name="synced" size={16} color={colors.subtle} />
      </View>
      <Text className="min-w-0 flex-1 text-sm leading-5 text-muted">{text}</Text>
    </View>
  );
}
