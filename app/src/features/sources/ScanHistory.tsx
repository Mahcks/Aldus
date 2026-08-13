import type { SourceScan } from '../../generated/api';
import { StatusBadge } from '../ui';
import { Text, View } from '../tw';
import { formatDate, scanStatus } from './helpers';

/** Compact list of a source's prior scans (most recent scan is shown on the card itself). */
export function ScanHistory({ scans }: { scans: SourceScan[] }) {
  if (scans.length === 0) return null;

  return (
    <View className="gap-2 border-t border-line pt-3">
      <Text className="text-sm font-extrabold text-ink">Recent scans</Text>
      {scans.map((scan) => (
        <View className="flex-row flex-wrap items-center gap-2" key={scan.id}>
          <StatusBadge {...scanStatus(scan.state)} />
          <Text className="text-sm text-muted">
            {formatDate(scan.finished_at ?? scan.started_at ?? scan.created_at)} · {scan.supported}{' '}
            discovered · {scan.problems} problems
          </Text>
        </View>
      ))}
    </View>
  );
}
