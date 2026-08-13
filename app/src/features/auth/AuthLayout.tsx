import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Text, View } from '../tw';

/**
 * Shared centered-panel layout for the pre-auth screens (login, setup).
 * These screens intentionally sit outside `Page`/`AppShell`, which only
 * apply once a user is authenticated, so they keep their own bespoke
 * wordmark + card composition instead of the shared shell. `KeyboardAvoidingView`
 * itself isn't a NativeWind-wrapped primitive, so it only carries layout
 * behavior; the inner `View` carries the actual visual styling.
 */
export function AuthLayout({ tagline, children }: PropsWithChildren<{ tagline?: string }>) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View className="min-h-full flex-1 flex-row flex-wrap items-center justify-center gap-14 bg-canvas p-6">
        <View className="max-w-[360px] gap-2">
          <Text className="text-[44px] font-black leading-[48px] tracking-[-1.5px] text-accent">
            Aldus
          </Text>
          {tagline ? <Text className="text-lg leading-7 text-muted">{tagline}</Text> : null}
        </View>
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Card shell for the form itself, shared between login and setup. */
export function AuthCard({ children }: PropsWithChildren) {
  return (
    <View className="w-full max-w-[420px] gap-3.5 rounded-dialog border border-line bg-paper p-7 shadow-card">
      {children}
    </View>
  );
}
