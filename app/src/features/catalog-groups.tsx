import { router } from 'expo-router';
import { useState } from 'react';
import type { CatalogGroup } from '@/generated/api';
import { AppIcon } from '@/features/icons';
import { Pressable, Text, View } from '@/features/tw';
import { Button, Section, colors, resolvePressStateClass } from '@/features/ui';

export function CatalogGroupSection({
  kind,
  groups,
  searching,
}: {
  kind: 'series' | 'narrators';
  groups: CatalogGroup[];
  searching: boolean;
}) {
  if (!groups.length) return null;
  const title = kind === 'series' ? 'Series' : 'Narrators';
  return (
    <Section
      title={searching ? title : `${title} in your library`}
      action={
        <Button
          label={`All ${kind}`}
          kind="quiet"
          onPress={() => router.push(`/catalog?kind=${kind}`)}
        />
      }
    >
      <View>
        {groups.slice(0, 4).map((group) => (
          <CatalogGroupRow
            key={`${group.library_id}:${group.name}`}
            group={group}
            onPress={() =>
              router.push({
                pathname: '/catalog',
                params:
                  kind === 'series'
                    ? { series: group.name, library_id: group.library_id }
                    : { narrator: group.name },
              })
            }
          />
        ))}
      </View>
    </Section>
  );
}

export function CatalogGroupRow({ group, onPress }: { group: CatalogGroup; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const state = resolvePressStateClass({ focused, pressed });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${group.work_count} books${group.library_name ? `, ${group.library_name}` : ''}`}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={`min-h-16 flex-row items-center gap-3 border-b border-line py-3 ${state}`}
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-sans-semibold text-ink">{group.name}</Text>
        <Text className="text-sm text-muted">
          {group.work_count} {group.work_count === 1 ? 'book' : 'books'}
          {group.library_name ? ` · ${group.library_name}` : ''}
        </Text>
      </View>
      <AppIcon name="chevron" size={20} color={colors.muted} />
    </Pressable>
  );
}
