import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, useWindowDimensions } from 'react-native';
import { ScrollView, Text, View } from '@/features/tw';
import { Button } from '@/features/ui';

/**
 * Shared page shell for every pre-auth screen (demo, connect, login,
 * setup). These screens intentionally sit outside `Page`/`AppShell`, which
 * only apply once a user is authenticated.
 *
 * The masthead ("Aldus" + a hairline rule) is rendered here, once, with no
 * variable content — no tagline, no per-screen sizing — so it is byte-for-
 * byte identical no matter which screen renders it. Earlier passes let each
 * screen pass its own tagline into a per-card header; that kept the
 * wordmark itself pinned, but the *rule* under it — and everything below —
 * still moved up or down depending on whether that screen's tagline existed
 * (login has one, setup doesn't), which reads as the whole page jumping
 * between screens. A masthead that takes no props can't drift. Page-specific
 * copy belongs in each screen's own heading/subtitle, not duplicated as a
 * second tagline under the brand mark.
 *
 * `Back` lives in its own fixed-height row above the masthead — not
 * folded into it — so it sits at a predictable spot near the top on every
 * screen that has one, and its absence (setup, demo) doesn't shift anything
 * below it, since the row's height is reserved either way.
 *
 * `wide` widens the content column for screens with more horizontal content
 * than a plain form (currently just the demo welcome screen's book shelf).
 *
 * `KeyboardAvoidingView` itself isn't a NativeWind-wrapped primitive, so it
 * only carries layout behavior; the inner `View` carries the actual visual
 * styling.
 */
export function AuthLayout({
  backLabel,
  onBack,
  wide,
  children,
}: PropsWithChildren<{ backLabel?: string; onBack?: () => void; wide?: boolean }>) {
  const compact = useWindowDimensions().width < 600;
  const contentClass = compact
    ? 'flex-grow px-5 pt-4 pb-10'
    : 'min-h-full flex-grow items-center px-6 pt-24 pb-16';
  const maxWidthClass = wide ? 'max-w-[640px]' : 'max-w-[440px]';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <View className="min-h-12 flex-row items-center px-3 pt-1">
          {onBack ? (
            <Button label={backLabel || 'Back'} icon="back" kind="quiet" onPress={onBack} />
          ) : null}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName={contentClass}>
          <View className={`w-full ${maxWidthClass} gap-5 self-center`}>
            <Text className="border-b border-line pb-3 font-editorial-bold text-3xl leading-9 text-accent">
              Aldus
            </Text>
            <View className="gap-3.5">{children}</View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
