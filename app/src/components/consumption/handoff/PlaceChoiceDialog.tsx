import { Button, Dialog, Notice, Radio } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import {
  conflictCopy,
  savedPlaceName,
  type HandoffDevice,
  type SavedPlaceOption,
} from '@/lib/consumption/handoff-copy';

/**
 * Asks which of two saved places to keep after reading offline. Nothing is
 * pre-selected, and "Decide later" keeps both places. The dialog only reports
 * the choice; applying it is the caller's job.
 */
export function PlaceChoiceDialog({
  visible,
  otherDevice,
  options,
  selectedId,
  busy = false,
  error,
  onSelect,
  onConfirm,
  onDecideLater,
}: {
  visible: boolean;
  otherDevice: HandoffDevice;
  options: SavedPlaceOption[];
  selectedId?: SavedPlaceOption['id'];
  busy?: boolean;
  error?: string;
  onSelect: (id: SavedPlaceOption['id']) => void;
  onConfirm: () => void;
  onDecideLater: () => void;
}) {
  const copy = conflictCopy(otherDevice);

  return (
    <Dialog
      visible={visible}
      title={copy.title}
      sheet
      onClose={onDecideLater}
      footer={
        <View className="gap-2">
          {selectedId ? null : <Text className="text-sm text-muted">{copy.help}</Text>}
          <View className="gap-2 sm:flex-row-reverse sm:justify-start">
            <Button
              label={copy.primary}
              kind="primary"
              disabled={!selectedId || busy}
              loading={busy}
              onPress={onConfirm}
            />
            <Button label={copy.secondary} kind="quiet" disabled={busy} onPress={onDecideLater} />
          </View>
        </View>
      }
    >
      <View className="gap-4">
        <Text className="text-base leading-6 text-text-secondary">{copy.body}</Text>
        {error ? <Notice danger>{error}</Notice> : null}
        <View accessibilityRole="radiogroup" accessibilityLabel={copy.groupLabel} className="gap-1">
          {options.map((option) => (
            <Radio
              key={option.id}
              label={savedPlaceName(option)}
              description={`${option.position} · ${option.savedLabel}`}
              selected={selectedId === option.id}
              disabled={busy}
              onPress={() => onSelect(option.id)}
            />
          ))}
        </View>
      </View>
    </Dialog>
  );
}
