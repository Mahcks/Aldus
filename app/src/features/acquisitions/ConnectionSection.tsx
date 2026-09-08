import { useState, type ReactNode } from 'react';
import { Button } from '@/features/ui';
import { Text, View } from '@/features/tw';

export function ConnectionSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-6 border-t border-line py-8 lg:flex-row lg:gap-12">
      <View className="gap-2 lg:w-60">
        <Text accessibilityRole="header" className="text-lg font-sans-semibold text-ink">
          {title}
        </Text>
        <Text className="text-sm leading-6 text-muted">{description}</Text>
      </View>
      <View className="min-w-0 gap-5 lg:flex-1">{children}</View>
    </View>
  );
}

export function ConnectionEditor({
  name,
  description,
  configured,
  help = false,
  children,
}: {
  name: string;
  description: string;
  configured: boolean;
  help?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(configured);
  return (
    <View className="gap-5">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-sans-semibold text-ink">{name}</Text>
          <Text className="text-sm text-muted">{description}</Text>
        </View>
        <Button
          label={
            help ? (open ? 'Hide help' : 'Show help') : open ? `Hide ${name}` : `Configure ${name}`
          }
          expanded={open}
          kind="quiet"
          onPress={() => setOpen(!open)}
        />
      </View>
      {open ? <View className="gap-4">{children}</View> : null}
    </View>
  );
}
