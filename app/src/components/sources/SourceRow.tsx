import { useState } from 'react';
import type { LibrarySource, SourceScan } from '@/generated/api';
import { AppIcon } from '@/components/ui/icons';
import { Button, Notice, Row, StatusBadge } from '@/components/ui';
import { useThemeColors } from '@/components/ui/theme';
import { Pressable, Text, View } from '@/components/ui/tw';
import { EntryList } from './EntryList';
import { formatDate, scanStatus, sourceStatus } from '@/lib/sources/helpers';
import { ScanHistory } from './ScanHistory';
import type { SourceDetails } from '@/lib/sources/types';

/**
 * One source, collapsed to a single glance by default — icon, name, status,
 * a book count — with the scan summary, actions and technical detail all
 * living behind one expand instead of always on screen. A library with
 * several sources used to repeat "Scan now / Inspect files / Source
 * settings" and a six-number grid once per source, all always visible; this
 * keeps the row list calm and puts that weight only where a reader actually
 * asked for it.
 */
export function SourceRow({
  source,
  details,
  admin,
  busy,
  expanded,
  onToggleExpanded,
  onScan,
  onEdit,
  onToggle,
  onRemove,
}: {
  source: LibrarySource;
  details?: SourceDetails;
  admin: boolean;
  busy: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onScan: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const latest = details?.scans[0];
  const active = latest ? ['pending', 'scanning'].includes(latest.state) : false;
  const status = sourceStatus(source, latest);
  const date = latest?.finished_at ?? latest?.started_at ?? latest?.created_at;

  return (
    <View className="w-full border-t border-line-subtle">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} details for ${source.name}`}
        onPress={onToggleExpanded}
        className="min-h-11 flex-row items-center gap-3.5 py-4"
      >
        <View className="h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft">
          <AppIcon name="folder" size={18} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-sans-bold text-ink">{source.name}</Text>
          <Text className="text-sm text-muted">
            Local filesystem
            {latest ? ` · scanned ${formatDate(date)}` : ' · not yet scanned'}
          </Text>
        </View>
        <StatusBadge {...status} />
        <AppIcon name={expanded ? 'chevronDown' : 'chevron'} size={18} />
      </Pressable>

      {expanded ? (
        <View className="gap-4 pb-5 pl-[54px]">
          {latest ? <ScanSummary scan={latest} /> : null}

          {source.auto_import ? (
            <Text className="text-sm text-muted">Clear matches import automatically.</Text>
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
              label={`${filesOpen ? 'Hide' : 'Inspect'} files (${details?.entries.length ?? 0})`}
              onPress={() => setFilesOpen((open) => !open)}
            />
            {admin ? (
              <Button
                label={settingsOpen ? 'Hide source settings' : 'Source settings'}
                kind="quiet"
                onPress={() => setSettingsOpen((open) => !open)}
              />
            ) : null}
          </Row>

          {!source.enabled ? (
            <Text className="text-sm text-muted">
              Enable this source in Source settings before scanning.
            </Text>
          ) : null}

          {admin && settingsOpen ? (
            <View className="gap-3 rounded-card border border-line bg-paper p-3.5">
              {source.root_path ? (
                <View className="gap-1">
                  <Text className="text-xs font-sans-bold text-muted">Server path</Text>
                  <Text selectable className="font-mono text-xs text-ink">
                    {source.root_path}
                  </Text>
                </View>
              ) : null}
              <Row>
                <Button label="Edit source" icon="edit" kind="secondary" onPress={onEdit} />
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

          {filesOpen ? (
            <View className="gap-4 rounded-card border border-line bg-paper p-3.5">
              {latest ? <ScanBreakdown scan={latest} /> : null}
              <ScanHistory scans={details?.scans.slice(1, 6) ?? []} />
              <EntryList entries={details?.entries ?? []} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One plain-language sentence instead of a permanent 6-number grid — the
 * full breakdown is still available (`ScanBreakdown`, below) behind
 * "Inspect files" for anyone who wants it. Only mentions counts that are
 * actually non-zero so a fully "ready" source reads as a short line.
 */
function ScanSummary({ scan }: { scan: SourceScan }) {
  const active = scan.state === 'scanning' || scan.state === 'pending';

  if (active) {
    return <Text className="text-sm text-muted">{scanStatus(scan.state).label}</Text>;
  }

  const parts = [`${scan.supported} ${scan.supported === 1 ? 'file' : 'files'} found`];
  if (scan.new > 0) parts.push(`${scan.new} new`);
  if (scan.changed > 0) parts.push(`${scan.changed} changed`);
  if (scan.missing > 0) parts.push(`${scan.missing} missing`);
  if (scan.auto_imported > 0) parts.push(`${scan.auto_imported} imported automatically`);

  return (
    <View className="gap-2">
      <Text className="text-sm text-muted">
        {parts.join(' · ')}
        {scan.problems > 0 ? (
          <Text className="font-sans-bold text-danger">
            {' '}
            · {scan.problems} {scan.problems === 1 ? 'problem' : 'problems'}
          </Text>
        ) : null}
      </Text>
      {scan.error ? <Notice danger>{scan.error}</Notice> : null}
    </View>
  );
}

/** The full number breakdown `ScanSummary` no longer shows by default — kept one expand away for anyone who wants it. */
function ScanBreakdown({ scan }: { scan: SourceScan }) {
  return (
    <View className="flex-row flex-wrap gap-3.5">
      <Count label="Discovered" value={scan.supported} />
      <Count label="New" value={scan.new} />
      <Count label="Changed" value={scan.changed} />
      <Count label="Unchanged" value={scan.unchanged} />
      <Count label="Missing" value={scan.missing} />
      <Count label="Problems" value={scan.problems} danger={scan.problems > 0} />
      {scan.auto_imported > 0 ? <Count label="Auto-imported" value={scan.auto_imported} /> : null}
    </View>
  );
}

function Count({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <View className="min-w-[62px]">
      <Text className={`text-[17px] font-sans-bold ${danger ? 'text-danger' : 'text-ink'}`}>
        {value}
      </Text>
      <Text className="text-[11px] text-muted">{label}</Text>
    </View>
  );
}
