import { useState } from 'react';
import { Platform } from 'react-native';
import { Button } from '../ui';
import { Text, View } from '../tw';

type DetailRow = {
  label: string;
  value: string;
  copyable?: boolean;
};

/**
 * Progressive-disclosure wrapper for admin-only technical values (raw
 * filesystem paths, SHA-256 hashes) that should never be primary, always-on
 * text. Collapsed by default; expanding reveals monospace rows with an
 * optional copy action.
 *
 * Copy-to-clipboard only runs on web, where `navigator.clipboard` is
 * available without adding a native module dependency; on native platforms
 * the copy control is simply omitted.
 */
export function TechnicalDetails({ rows }: { rows: DetailRow[] }) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = () => setExpanded((current) => !current);

  if (rows.length === 0) return null;

  return (
    <View className="items-start gap-2">
      <Button
        label={expanded ? 'Hide technical details' : 'Technical details'}
        kind="quiet"
        onPress={toggleExpanded}
      />
      {expanded ? (
        <View className="w-full gap-2 rounded-control bg-canvas p-3">
          {rows.map((row) => (
            <DetailRowView key={row.label} row={row} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DetailRowView({ row }: { row: DetailRow }) {
  const handleCopy = () => void copyToClipboard(row.value);
  const canCopy = row.copyable && Platform.OS === 'web';

  return (
    <View className="gap-1">
      <Text className="text-xs font-bold text-muted">{row.label}</Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text selectable className="flex-shrink font-mono text-xs text-ink">
          {row.value}
        </Text>
        {canCopy ? <Button label="Copy" kind="quiet" onPress={handleCopy} /> : null}
      </View>
    </View>
  );
}

async function copyToClipboard(value: string) {
  if (Platform.OS !== 'web') return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard access can be denied by the browser; silently no-op rather
    // than surface an error for a non-essential convenience action.
  }
}
