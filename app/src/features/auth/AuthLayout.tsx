import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, useWindowDimensions } from 'react-native';
import { ScrollView, Text, View } from '@/features/tw';
import { IconButton, colors } from '@/features/ui';

/** One public shell keeps navigation, form width and keyboard behavior consistent. */
export function AuthLayout({
  backLabel,
  onBack,
  wide,
  children,
}: PropsWithChildren<{ backLabel?: string; onBack?: () => void; wide?: boolean }>) {
  const compact = useWindowDimensions().width < 600;
  const contentClass = compact
    ? 'flex-grow px-5 pt-8 pb-10'
    : 'min-h-full flex-grow items-center px-6 pt-16 pb-16';
  const maxWidthClass = wide ? 'max-w-[640px]' : 'max-w-[440px]';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <View className="min-h-16 flex-row items-center gap-3 border-b border-line-subtle px-4">
          {onBack ? (
            <IconButton label={backLabel || 'Back'} icon="back" kind="quiet" onPress={onBack} />
          ) : null}
          <Text className="font-editorial text-2xl text-ink">Aldus</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName={contentClass}>
          <View className={`w-full ${maxWidthClass} gap-5 self-center`}>
            <View className="gap-5">{children}</View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
