import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, useWindowDimensions } from 'react-native';
import { ScrollView, Text, View } from '../tw';

/**
 * Shared centered-panel layout for the pre-auth screens (login, setup).
 * These screens intentionally sit outside `Page`/`AppShell`, which only
 * apply once a user is authenticated, so they keep their own bespoke
 * wordmark + card composition instead of the shared shell. `KeyboardAvoidingView`
 * itself isn't a NativeWind-wrapped primitive, so it only carries layout
 * behavior; the inner `View` carries the actual visual styling.
 */
export function AuthLayout({ tagline, children }: PropsWithChildren<{ tagline?: string }>) {
  const compact = useWindowDimensions().width < 600;
  const contentClass = compact
    ? 'flex-grow justify-center gap-6 bg-canvas px-4 py-6'
    : 'min-h-full flex-grow flex-row flex-wrap items-center justify-center gap-14 bg-canvas p-6';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName={contentClass}>
          <View className="w-full max-w-[360px] gap-2">
            <Text
              className={`${compact ? 'text-4xl leading-10' : 'text-[44px] leading-[48px]'} font-black tracking-[-1.5px] text-accent`}
            >
              Aldus
            </Text>
            {tagline ? <Text className="text-lg leading-7 text-muted">{tagline}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/** Card shell for the form itself, shared between login and setup. */
export function AuthCard({ children }: PropsWithChildren) {
  const compact = useWindowDimensions().width < 600;

  return (
    <View
      className={`w-full max-w-[420px] gap-3.5 rounded-dialog border border-line bg-paper shadow-card ${compact ? 'p-5' : 'p-7'}`}
    >
      {children}
    </View>
  );
}
