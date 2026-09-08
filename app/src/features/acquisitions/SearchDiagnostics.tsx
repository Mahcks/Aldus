import { useState } from 'react';
import type { AcquisitionConnectionStatus, AcquisitionSearchReport } from '@/generated/api';
import { Text, View } from '@/features/tw';
import { Button, Notice, StatusBadge } from '@/features/ui';

export function SearchDiagnostics({
  report,
  onRetry,
  context = 'search',
}: {
  report: AcquisitionSearchReport;
  onRetry?: () => void;
  context?: 'search' | 'connection';
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = report.indexers.filter((item) => item.error).length;
  const excluded = report.indexers.reduce((sum, item) => sum + item.excluded, 0);
  const total = report.indexers.length;
  const hasConnectionIssue = failed > 0 || !total || !report.reachable;
  let summaryTone: 'warning' | 'success' | 'info' = context === 'connection' ? 'success' : 'info';
  if (hasConnectionIssue) summaryTone = 'warning';

  let summary = `${total} search source${total === 1 ? '' : 's'} responded.`;
  if (!report.reachable) summary = 'Search provider unavailable.';
  else if (!total)
    summary = 'No matching indexers. Enable an indexer for your configured download client.';
  else if (failed === total)
    summary = 'All indexers failed. Check their connections in your search provider.';
  else if (failed) summary = `Partial search: ${total - failed} of ${total} indexers responded.`;

  return (
    <View className="gap-2">
      <Notice tone={summaryTone}>
        {summary}
        {context === 'search' && excluded > 0
          ? ` ${excluded} release${excluded === 1 ? '' : 's'} excluded because the format is unsupported or unrecognized.`
          : ''}
      </Notice>
      {context === 'connection' && report.reachable && total > failed ? (
        <Text className="text-sm leading-5 text-muted">
          Each request searches the connected sources for matching books. A connection check does
          not need to find a book.
        </Text>
      ) : null}
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
                {item.error ||
                  (context === 'connection'
                    ? 'Connection successful.'
                    : `${item.results} supported releases returned.`)}
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

function DownloadClientDiagnostics({
  name,
  connected,
  error,
  fileVisibility,
  fileError,
}: {
  name: string;
  connected: boolean;
  error?: string;
  fileVisibility?: string;
  fileError?: string;
}) {
  let fileLabel = 'File access not verified';
  let fileDetail =
    'Finish a download, set the shared completed folder above, then test again. Aldus needs a completed file to check access.';

  if (fileVisibility === 'ok') {
    fileLabel = 'File access verified';
    fileDetail = 'Aldus can read a completed download from this client.';
  } else if (fileVisibility === 'failed') {
    fileLabel = 'File access unavailable';
    fileDetail =
      fileError || 'Check the shared completed folder and allow Aldus to read it, then test again.';
  } else if (!connected) {
    fileDetail = 'Restore the connection first, then test again to check completed files.';
  }

  return (
    <View className="gap-3 border-t border-line-subtle pt-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-base font-sans-semibold text-ink">{name}</Text>
        <StatusBadge
          tone={connected ? 'success' : 'danger'}
          label={`${name} ${connected ? 'connected' : 'unavailable'}`}
        />
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View className="gap-1">
        <Text className="text-sm font-sans-semibold text-ink">{fileLabel}</Text>
        <Text className="text-sm leading-5 text-muted">{fileDetail}</Text>
      </View>
    </View>
  );
}

export function ConnectionDiagnostics({ status }: { status: AcquisitionConnectionStatus }) {
  return (
    <View className="gap-4 border-t border-line pt-4">
      <View className="gap-2">
        <Text className="text-base font-sans-semibold text-ink">Search connections</Text>
        {status.search ? (
          <SearchDiagnostics report={status.search} context="connection" />
        ) : (
          <Notice tone={status.prowlarr_ok ? 'success' : 'warning'}>
            {status.prowlarr_ok
              ? `${status.indexer_count} enabled indexers. Update the server for detailed search checks.`
              : status.prowlarr_error || 'Search provider unavailable.'}
          </Notice>
        )}
      </View>
      {status.qbittorrent_configured !== false ? (
        <DownloadClientDiagnostics
          name="qBittorrent"
          connected={status.qbittorrent_ok}
          error={status.qbittorrent_error}
          fileVisibility={status.file_visibility}
          fileError={status.file_error}
        />
      ) : null}
      {status.sabnzbd_configured ? (
        <DownloadClientDiagnostics
          name="SABnzbd"
          connected={Boolean(status.sabnzbd_ok)}
          error={status.sabnzbd_error}
          fileVisibility={status.sabnzbd_file_visibility}
          fileError={status.sabnzbd_file_error}
        />
      ) : null}
    </View>
  );
}
