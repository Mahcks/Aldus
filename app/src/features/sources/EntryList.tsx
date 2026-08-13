import type { SourceEntry } from '../../generated/api';
import { Empty, Notice, StatusBadge } from '../ui';
import { Text, View } from '../tw';
import { entryStatus, formatBytes, metadataText } from './helpers';
import { TechnicalDetails } from './TechnicalDetails';

/** Per-file inventory for a source, shown when a `SourceCard` is expanded. */
export function EntryList({ entries }: { entries: SourceEntry[] }) {
  if (entries.length === 0) return <Empty>No discovered files yet.</Empty>;

  return (
    <View className="border-t border-line pt-2">
      <Text className="pb-2 text-sm font-extrabold text-ink">Discovered files</Text>
      {entries.map((entry) => (
        <EntryRow entry={entry} key={entry.id} />
      ))}
    </View>
  );
}

function EntryRow({ entry }: { entry: SourceEntry }) {
  const title = metadataText(entry, 'title');
  const author = metadataText(entry, 'author') || metadataText(entry, 'artist');
  const extra = [metadataText(entry, 'narrator'), metadataText(entry, 'series')]
    .filter(Boolean)
    .join(' · ');
  const status = entryStatus(entry.state);

  return (
    <View className="gap-1.5 border-b border-line py-3">
      <View className="flex-row items-start justify-between gap-3">
        <Text selectable className="flex-shrink text-xs leading-[18px] text-ink">
          {entry.relative_path}
        </Text>
        <StatusBadge {...status} />
      </View>
      <Text className="text-sm text-muted">
        {entry.kind || 'Unknown format'} · {formatBytes(entry.size_bytes)}
      </Text>
      {title || author ? (
        <Text className="text-sm text-muted">{[title, author].filter(Boolean).join(' — ')}</Text>
      ) : null}
      {extra ? <Text className="text-sm text-muted">{extra}</Text> : null}
      {entry.error ? <Notice danger>{entry.error}</Notice> : null}
      {entry.sha256 ? (
        <TechnicalDetails rows={[{ label: 'SHA-256', value: entry.sha256, copyable: true }]} />
      ) : null}
    </View>
  );
}
