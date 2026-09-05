import { useEffect, useState } from 'react';
import { Text, View } from './tw';
import { Button, LoadingState, Notice, Section, StatusBadge } from './ui';
import { DownloadInterrupted } from '@/lib/download-interrupted';
import { APIError, errorMessage } from '@/lib/api';
import {
  cancelDownload,
  listDownloads,
  pauseDownload,
  subscribeDownloads,
  type DownloadItem,
} from '@/lib/native-download';
import { activeStorageScope } from '@/lib/storage-scope';
import { removeOfflineWork, retryOfflineDownload } from '@/lib/offline-library';

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DownloadStatus({
  mediaIDs,
  compact = false,
  error: parentError = '',
}: {
  mediaIDs?: string[];
  compact?: boolean;
  error?: string;
}) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string[]>([]);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    async function refresh() {
      const request = ++revision;
      const scope = activeStorageScope();
      try {
        const next = await listDownloads();
        if (!disposed && request === revision && scope === activeStorageScope()) setItems(next);
      } catch (value) {
        if (!disposed) setError(errorMessage(value));
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    const unsubscribe = subscribeDownloads(() => void refresh());
    void refresh();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  async function act(item: DownloadItem, action: 'pause' | 'cancel' | 'retry' | 'remove') {
    const scope = activeStorageScope();
    setBusy((current) => [...current, item.id]);
    setError('');
    try {
      if (action === 'pause') await pauseDownload(item.id);
      if (action === 'cancel') await cancelDownload(item.id);
      if (action === 'retry') await retryOfflineDownload(item.id);
      if (action === 'remove' && item.workID)
        await removeOfflineWork(item.workID, item.filename.endsWith('.epub') ? 'epub' : 'audio');
    } catch (value) {
      if (!(value instanceof DownloadInterrupted) && scope === activeStorageScope()) {
        const latest = await listDownloads().catch(() => []);
        const alreadyReported =
          value instanceof Error &&
          latest.some(
            (entry) =>
              (entry.id === item.id || (item.workID && entry.workID === item.workID)) &&
              entry.status === 'failed' &&
              entry.error === value.message,
          );
        if (!alreadyReported)
          setError(
            value instanceof Error && !(value instanceof APIError)
              ? value.message
              : errorMessage(value),
          );
      }
    } finally {
      setBusy((current) => current.filter((id) => id !== item.id));
    }
  }

  const visible = mediaIDs ? items.filter((item) => mediaIDs.includes(item.id)) : items;
  return (
    <DownloadList
      items={visible}
      compact={compact}
      loading={loading}
      error={error || parentError}
      busy={busy}
      onAction={act}
    />
  );
}

export function DownloadList({
  items: visible,
  compact = false,
  loading = false,
  error = '',
  busy = [],
  onAction,
}: {
  items: DownloadItem[];
  compact?: boolean;
  loading?: boolean;
  error?: string;
  busy?: string[];
  onAction: (item: DownloadItem, action: 'pause' | 'cancel' | 'retry' | 'remove') => Promise<void>;
}) {
  if (loading) return compact ? null : <LoadingState label="Loading downloads" />;
  if (!visible.length && !error) return null;
  const used = visible.reduce((total, item) => total + (item.storageBytes ?? item.bytes), 0);

  const rows = (
    <View className="gap-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {visible.map((item) => {
        const active = item.status === 'downloading' || item.status === 'queued';
        const pending = busy.includes(item.id);
        const bytes = active ? (item.transferredBytes ?? item.bytes) : item.bytes;
        return (
          <View
            key={item.id}
            className={
              compact ? 'gap-1 border-b border-line py-2' : 'gap-2 border-b border-line py-3'
            }
          >
            {!compact ? (
              <Text className="text-base font-sans-medium text-ink">{item.label}</Text>
            ) : null}
            <View className="flex-row flex-wrap items-center gap-2">
              {compact ? (
                <Text className="text-sm font-sans-semibold text-ink">
                  {item.filename.endsWith('.epub') ? 'Ebook' : 'Audiobook'}
                </Text>
              ) : null}
              <StatusBadge
                label={item.status === 'complete' ? 'Saved' : item.status}
                tone={item.status === 'failed' ? 'danger' : 'neutral'}
              />
              <Text
                className="text-sm text-muted"
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: item.expectedSize, now: bytes }}
                accessibilityLabel={`${compact ? (item.filename.endsWith('.epub') ? 'Ebook' : 'Audiobook') : item.label} download progress`}
              >
                {megabytes(bytes)} of {megabytes(item.expectedSize)}
              </Text>
            </View>
            {item.status === 'failed' && item.error ? (
              <Text className="text-sm text-muted">{item.error}</Text>
            ) : null}
            {pending && !active ? (
              <Text className="text-sm text-muted">Updating download…</Text>
            ) : null}
            {item.status === 'complete' && item.workID ? (
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label={item.filename.endsWith('.epub') ? 'Remove ebook' : 'Remove audiobook'}
                  kind="quiet"
                  loading={pending}
                  onPress={() => void onAction(item, 'remove')}
                />
              </View>
            ) : null}
            {item.status !== 'complete' ? (
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label={active ? 'Pause' : item.status === 'failed' ? 'Retry' : 'Resume'}
                  kind={compact ? 'quiet' : 'secondary'}
                  loading={pending && !active}
                  onPress={() => void onAction(item, active ? 'pause' : 'retry')}
                />
                <Button
                  label={compact ? 'Cancel' : 'Cancel download'}
                  kind="quiet"
                  onPress={() => void onAction(item, 'cancel')}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
  if (compact) return rows;
  return (
    <Section title="Downloads on this device">
      <Text className="text-sm text-muted">
        {megabytes(used)} saved. Keep Aldus open while downloading.
      </Text>
      {rows}
    </Section>
  );
}
