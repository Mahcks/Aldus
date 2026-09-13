import { router } from 'expo-router';
import type { Representation } from '@/generated/api';
import type { MediaChoice } from '@/lib/consumption/consumption';
import { formatMediaSize as formatBytes } from '@/lib/format';
import { Pressable, Text, View } from '@/components/ui/tw';
import { shared } from '@/components/ui';

export function RepresentationGroup({
  title,
  items,
  media,
}: {
  title: string;
  items: Representation[];
  media: MediaChoice[];
}) {
  return (
    <View className="gap-2">
      <Text className="text-base font-sans-bold text-ink">{title}</Text>
      {items.length ? (
        <View className="border-t border-line">
          {items.map((item) => {
            const revisions = media.filter((revision) => revision.representation_id === item.id);
            const newest = revisions[0];
            const detail = newest
              ? `${newest.original_filename || 'Unnamed file'} · ${formatBytes(newest.size_bytes)} · ${revisions.length} ${revisions.length === 1 ? 'revision' : 'revisions'}`
              : 'No uploaded file';
            return (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Manage ${item.label}`}
                key={item.id}
                className="min-h-14 flex-row items-center gap-4 border-b border-line py-3.5"
                onPress={() => router.push(`/representation/${item.id}`)}
              >
                <View className="min-w-0 flex-1 gap-1">
                  <Text className={shared.itemTitle}>{item.label}</Text>
                  <Text numberOfLines={2} className={shared.itemMeta}>
                    {detail}
                  </Text>
                </View>
                <Text className="text-sm font-sans-bold text-accent">Manage</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text className={shared.itemMeta}>None added.</Text>
      )}
    </View>
  );
}
