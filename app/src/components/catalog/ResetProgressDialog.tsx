import { useEffect, useRef, useState } from 'react';
import type { ClaimReadingSessionRequest, ReadingClaim } from '@/generated/api';
import { Button, Dialog, LoadingState, Notice } from '@/components/ui';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';
import { APIError, api, errorMessage } from '@/lib/api';
import { getDeviceIdentity } from '@/lib/device-identity';
import { randomID } from '@/lib/random-id';
import { OwnershipSupersededError } from '@/lib/consumption/reading-proof';
import { cacheReadingProof } from '@/lib/consumption/reading-proof-cache';
import { applyReadingReset } from '@/lib/consumption/reading-reset';

export function ResetProgressDialog({
  workID,
  title,
  onClose,
  onReset,
}: {
  workID: string;
  title: string;
  onClose: () => void;
  onReset: () => void;
}) {
  const [request, setRequest] = useState<ClaimReadingSessionRequest>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const result = useRef<ReadingClaim | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      try {
        const [owner, device] = await Promise.all([
          api.readingSession(workID),
          getDeviceIdentity(),
        ]);
        if (!cancelled)
          setRequest({
            device_id: device.deviceID,
            label: device.label,
            platform: device.platform,
            expected_epoch: owner?.epoch ?? 0,
            request_id: randomID(),
          });
      } catch (error) {
        if (!cancelled) setError(errorMessage(error));
      }
    }
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [workID]);

  async function reset() {
    if (!request || busy || conflict) return;
    setBusy(true);
    setError('');
    try {
      result.current ??= await api.resetReadingProgress(workID, request);
      await applyReadingReset(workID, result.current);
      await cacheReadingProof(workID, {
        device_id: result.current.owner.device_id,
        epoch: result.current.owner.epoch,
      });
      onReset();
      onClose();
    } catch (error) {
      if (result.current) {
        setError('Progress was reset on the server. Retry to refresh this device before reading.');
      } else if (
        (error instanceof APIError && error.status === 409) ||
        error instanceof OwnershipSupersededError
      ) {
        setConflict(true);
        setError(
          'Another device took over this book. Close this dialog and try again to reset its current place.',
        );
      } else setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog visible title={`Start “${title}” over?`} dismissible={!busy} onClose={onClose}>
      <View className="gap-5">
        <Notice tone="warning" title="This can’t be undone">
          Your saved place is cleared for both reading and listening. Your other devices pick this
          up the next time they connect.
        </Notice>
        <View className="gap-4 sm:flex-row">
          <ResetEffects
            title="Resets"
            icon="close"
            items={['Your place in the book', 'Your percent complete']}
          />
          <ResetEffects
            title="Kept"
            icon="check"
            items={[
              'Highlights and notes',
              'Reading time and history',
              'Status and reader settings',
              'Other readers’ progress',
            ]}
          />
        </View>
        {error ? <Notice danger>{error}</Notice> : null}
        {!request && !error ? <LoadingState label="Checking your saved place…" /> : null}
        <View className="flex-row flex-wrap gap-3">
          <Button label="Cancel" kind="secondary" disabled={busy} onPress={onClose} />
          <Button
            label="Start over"
            kind="danger"
            loading={busy}
            disabled={!request || conflict}
            onPress={() => void reset()}
          />
        </View>
      </View>
    </Dialog>
  );
}

function ResetEffects({
  title,
  icon,
  items,
}: {
  title: string;
  icon: AppIconName;
  items: string[];
}) {
  const colors = useThemeColors();

  return (
    <View className="min-w-0 flex-1 gap-2">
      <Text className="text-xs font-sans-bold uppercase tracking-wide text-subtle">{title}</Text>
      {items.map((item) => (
        <View key={item} className="flex-row items-center gap-2">
          <AppIcon
            name={icon}
            size={16}
            color={icon === 'check' ? colors.success : colors.danger}
          />
          <Text className="min-w-0 flex-1 text-sm text-ink">{item}</Text>
        </View>
      ))}
    </View>
  );
}
