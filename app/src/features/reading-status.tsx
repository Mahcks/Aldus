import type { WorkDetail, WorkSummary } from '@/generated/api';
import { Button, Dialog, Radio } from './ui';
import { Text, View } from './tw';

export type ReadingStatus = WorkDetail['reading_status'];

export function readingStatusLabel(status: ReadingStatus) {
  return {
    want_to_read: 'Want to read',
    reading: 'Reading',
    finished: 'Finished',
    '': 'Set status',
  }[status];
}

export function ReadingStatusDialog({
  work,
  visible,
  busy,
  onChange,
  onClose,
}: {
  work?: WorkDetail | WorkSummary;
  visible: boolean;
  busy: boolean;
  onChange: (status: ReadingStatus) => void;
  onClose: () => void;
}) {
  if (!work) return null;
  return (
    <Dialog visible={visible} title="Reading status" onClose={onClose}>
      <Text className="text-sm text-muted">Keep {work.title} organized for you.</Text>
      <View accessibilityRole="radiogroup" className="mt-3 gap-1">
        {(
          [
            ['want_to_read', 'Want to read'],
            ['reading', 'Reading'],
            ['finished', 'Finished'],
          ] as const
        ).map(([status, label]) => (
          <Radio
            key={status}
            label={label}
            selected={work.reading_status === status}
            onPress={() => onChange(status)}
          />
        ))}
      </View>
      {work.reading_status ? (
        <Button label="Remove status" kind="quiet" disabled={busy} onPress={() => onChange('')} />
      ) : null}
    </Dialog>
  );
}
