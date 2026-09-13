import type { MediaChoice } from '@/lib/consumption/consumption';
import { formatMediaSize as formatBytes } from '@/lib/format';
import { Text, View } from '@/components/ui/tw';
import { Empty, Radio, shared } from '@/components/ui';

export function RevisionChoiceList({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: MediaChoice[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View className={shared.grow}>
      <Text className={shared.itemTitle}>{title}</Text>
      {items.length === 0 ? (
        <Empty>None available.</Empty>
      ) : (
        items.map((item) => (
          <View key={item.id} className="gap-1 border-b border-line py-3">
            <Radio
              label={item.original_filename || item.representation.label}
              selected={selected === item.id}
              onPress={() => onSelect(item.id)}
            />
            <Text className="pl-8 text-sm text-muted">
              {formatBytes(item.size_bytes)} · {item.representation.label}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

export function SyncSourceSummary({ title, item }: { title: string; item: MediaChoice }) {
  return (
    <View className="min-w-[240px] flex-1 gap-1">
      <Text className="text-sm font-sans-semibold text-muted">{title}</Text>
      <Text numberOfLines={2} className={shared.itemTitle}>
        {item.representation.label || item.original_filename}
      </Text>
      <Text className={shared.itemMeta}>
        {item.representation.narrators?.join(', ') || item.original_filename} ·{' '}
        {formatBytes(item.size_bytes)}
      </Text>
    </View>
  );
}
