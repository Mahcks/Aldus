import { useState } from 'react';
import { Platform } from 'react-native';
import type { SourceEntry } from '@/generated/api';
import { Button, Empty, IconButton, Notice, StatusBadge } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import { entryStatus, formatBytes, metadataText } from '@/lib/sources/helpers';
import { copyToClipboard } from './TechnicalDetails';

/**
 * Per-file inventory for a source, shown when a `SourceRow` has its file
 * list expanded. A library can easily discover hundreds of files, so each
 * one is a single dense row — path, format/size and status on one line, an
 * optional metadata line below — rather than the small always-open card
 * each file used to get. The hash is real but rarely needed, so it moves
 * behind one small toggle per row instead of a permanent text link.
 */
export function EntryList({ entries }: { entries: SourceEntry[] }) {
  if (entries.length === 0) return <Empty>No discovered files yet.</Empty>;

  return (
    <View className="border-t border-line pt-2">
      <Text className="pb-1 text-sm font-sans-bold text-ink">
        Discovered files · {entries.length}
      </Text>
      {entries.map((entry, index) => (
        <EntryRow entry={entry} key={entry.id} showDivider={index < entries.length - 1} />
      ))}
    </View>
  );
}

function EntryRow({ entry, showDivider }: { entry: SourceEntry; showDivider: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const title = metadataText(entry, 'title');
  const author = metadataText(entry, 'author') || metadataText(entry, 'artist');
  const byline = title && author ? `${title} — ${author}` : title || author;
  const metaLine = [byline, metadataText(entry, 'narrator'), metadataText(entry, 'series')]
    .filter(Boolean)
    .join(' · ');
  const status = entryStatus(entry.state);
  const canCopy = Platform.OS === 'web';
  const sha256 = entry.sha256;

  return (
    <View className={`gap-0.5 py-2.5 ${showDivider ? 'border-b border-line' : ''}`}>
      <View className="flex-row items-center gap-2">
        <Text selectable numberOfLines={1} className="min-w-0 flex-1 text-sm text-ink">
          {entry.relative_path}
        </Text>
        <Text className="shrink-0 text-xs text-muted">
          {entry.kind || 'Unknown'} · {formatBytes(entry.size_bytes)}
        </Text>
        <StatusBadge {...status} />
        {sha256 ? (
          <IconButton
            icon={detailsOpen ? 'chevronUp' : 'chevronDown'}
            label={`${detailsOpen ? 'Hide' : 'Show'} technical details for ${entry.relative_path}`}
            kind="quiet"
            onPress={() => setDetailsOpen((open) => !open)}
          />
        ) : null}
      </View>
      {metaLine ? (
        <Text numberOfLines={1} className="text-xs text-muted">
          {metaLine}
        </Text>
      ) : null}
      {entry.error ? <Notice danger>{entry.error}</Notice> : null}
      {detailsOpen && sha256 ? (
        <View className="mt-1 gap-1 rounded-control bg-canvas p-3">
          <Text className="text-xs font-sans-bold text-muted">SHA-256</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Text selectable className="flex-shrink font-mono text-xs text-ink">
              {sha256}
            </Text>
            {canCopy ? (
              <Button label="Copy" kind="quiet" onPress={() => void copyToClipboard(sha256)} />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
