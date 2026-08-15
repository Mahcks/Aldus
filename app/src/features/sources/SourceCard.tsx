import type { LibrarySource, SourceScan } from '../../generated/api';
import { Button, Notice, Row, StatusBadge } from '../ui';
import { Text, View } from '../tw';
import { EntryList } from './EntryList';
import { formatDate, scanStatus, sourceStatus } from './helpers';
import { ScanHistory } from './ScanHistory';
import { TechnicalDetails } from './TechnicalDetails';
import type { SourceDetails } from './types';

export function SourceCard({
  source,
  details,
  admin,
  busy,
  expanded,
  onScan,
  onEdit,
  onToggle,
  onRemove,
  onToggleEntries,
}: {
  source: LibrarySource;
  details?: SourceDetails;
  admin: boolean;
  busy: boolean;
  expanded: boolean;
  onScan: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onToggleEntries: () => void;
}) {
  const latest = details?.scans[0];
  const active = latest ? ['pending', 'scanning'].includes(latest.state) : false;
  const status = sourceStatus(source, latest);

  return (
    <View className="w-full max-w-[760px] gap-3.5 rounded-card border border-line bg-paper p-[18px]">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-lg font-extrabold leading-[23px] text-ink">{source.name}</Text>
          <Text className="text-sm text-muted">Local filesystem</Text>
        </View>
        <StatusBadge {...status} />
      </View>

      {latest ? (
        <ScanSummary scan={latest} />
      ) : (
        <Text className="text-sm text-muted">Not yet scanned</Text>
      )}

      {admin && source.root_path ? (
        <TechnicalDetails rows={[{ label: 'Server path', value: source.root_path }]} />
      ) : null}

      <Row>
        <Button
          label={active ? 'Scan in progress…' : 'Scan now'}
          icon="scan"
          kind="primary"
          disabled={busy || !source.enabled || active}
          onPress={onScan}
        />
        <Button
          label={`${expanded ? 'Hide' : 'Inspect'} files (${details?.entries.length ?? 0})`}
          onPress={onToggleEntries}
        />
        {admin ? <Button label="Edit" icon="edit" kind="quiet" onPress={onEdit} /> : null}
      </Row>

      {admin ? (
        <View className="border-t border-line pt-3.5">
          <Row>
            <Button
              label={source.enabled ? 'Disable' : 'Enable'}
              kind="quiet"
              disabled={busy}
              onPress={onToggle}
            />
            <Button
              label="Remove"
              icon="delete"
              kind="danger"
              disabled={busy || active}
              onPress={onRemove}
            />
          </Row>
        </View>
      ) : null}

      {expanded ? (
        <>
          <ScanHistory scans={details?.scans.slice(1, 6) ?? []} />
          <EntryList entries={details?.entries ?? []} />
        </>
      ) : null}
    </View>
  );
}

function ScanSummary({ scan }: { scan: SourceScan }) {
  const date = scan.finished_at ?? scan.started_at ?? scan.created_at;

  return (
    <View className="gap-2.5 rounded-control bg-canvas p-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <StatusBadge {...scanStatus(scan.state)} />
        <Text className="text-sm text-muted">{formatDate(date)}</Text>
      </View>
      <View className="flex-row flex-wrap gap-3.5">
        <Count label="Discovered" value={scan.supported} />
        <Count label="New" value={scan.new} />
        <Count label="Changed" value={scan.changed} />
        <Count label="Unchanged" value={scan.unchanged} />
        <Count label="Missing" value={scan.missing} />
        <Count label="Problems" value={scan.problems} danger={scan.problems > 0} />
      </View>
      {scan.error ? <Notice danger>{scan.error}</Notice> : null}
    </View>
  );
}

function Count({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <View className="min-w-[62px]">
      <Text className={`text-[17px] font-extrabold ${danger ? 'text-danger' : 'text-ink'}`}>
        {value}
      </Text>
      <Text className="text-[11px] text-muted">{label}</Text>
    </View>
  );
}
