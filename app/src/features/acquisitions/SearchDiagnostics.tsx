import { useState } from 'react';
import type { AcquisitionConnectionStatus, AcquisitionSearchReport } from '@/generated/api';
import { Text, View } from '@/features/tw';
import { Button, Notice, StatusBadge } from '@/features/ui';

export function SearchDiagnostics({
  report,
  onRetry,
}: {
  report: AcquisitionSearchReport;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = report.indexers.filter((item) => item.error).length;
  const excluded = report.indexers.reduce((sum, item) => sum + item.excluded, 0);
  const total = report.indexers.length;
  let summary = `${total} search source${total === 1 ? '' : 's'} responded.`;
  if (!report.reachable) summary = 'Search provider unavailable.';
  else if (!total) summary = 'No enabled torrent indexers. Enable one in Prowlarr.';
  else if (failed === total) summary = 'All indexers failed. Check their connections in Prowlarr.';
  else if (failed) summary = `Partial search: ${total - failed} of ${total} indexers responded.`;

  return (
    <View className="gap-2">
      <Notice tone={failed || !total || !report.reachable ? 'warning' : 'info'}>
        {summary}
        {excluded > 0
          ? ` ${excluded} release${excluded === 1 ? '' : 's'} excluded because the format is unsupported or unrecognized.`
          : ''}
      </Notice>
      <View className="flex-row flex-wrap items-center gap-2">
        {total > 0 ? (
          <Button
            label={expanded ? 'Hide search details' : 'Show search details'}
            kind="quiet"
            onPress={() => setExpanded(!expanded)}
          />
        ) : null}
        {onRetry ? <Button label="Search again" kind="quiet" onPress={onRetry} /> : null}
      </View>
      {expanded ? (
        <View className="gap-3">
          {report.indexers.map((item, index) => (
            <View key={index} className="gap-1 border-t border-line-subtle pt-3">
              <Text className="text-sm font-sans-semibold text-ink">{item.name}</Text>
              <Text className="text-sm text-muted">
                {item.error || `${item.results} supported releases returned.`}
              </Text>
              {item.capabilities ? (
                <Text className="text-sm text-muted">{item.capabilities}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ConnectionDiagnostics({ status }: { status: AcquisitionConnectionStatus }) {
  return (
    <View className="gap-4 border-t border-line pt-4">
      {status.search ? (
        <SearchDiagnostics report={status.search} />
      ) : (
        <Notice tone={status.prowlarr_ok ? 'info' : 'warning'}>
          {status.prowlarr_ok
            ? `${status.indexer_count} enabled torrent indexers. Update the server for detailed search checks.`
            : status.prowlarr_error || 'Search provider unavailable.'}
        </Notice>
      )}
      <View className="items-start gap-2">
        <StatusBadge
          tone={status.qbittorrent_ok ? 'success' : 'danger'}
          label={status.qbittorrent_ok ? 'qBittorrent connected' : 'qBittorrent unavailable'}
        />
        {status.qbittorrent_error ? (
          <Notice tone="danger">{status.qbittorrent_error}</Notice>
        ) : null}
        <Text className="text-sm text-muted">
          {status.file_visibility === 'ok'
            ? 'Completed download files are visible to Aldus.'
            : status.file_visibility === 'failed'
              ? status.file_error
              : 'File access not tested. Aldus needs a completed download and a configured shared download root to verify it.'}
        </Text>
      </View>
    </View>
  );
}
