import { Button, Notice } from '@/components/ui';
import { pausedCopy, type HandoffDevice, type PausedSurface } from '@/lib/consumption/handoff-copy';

/**
 * Persistent notice on the device that lost the session. It stays until the
 * user presses "Resume here"; no other interaction reclaims control.
 */
export function PausedElsewhereNotice({
  surface,
  device,
  resuming = false,
  onResume,
}: {
  surface: PausedSurface;
  device: HandoffDevice;
  resuming?: boolean;
  onResume: () => void;
}) {
  const copy = pausedCopy(surface, device);

  return (
    <Notice
      tone="info"
      announcement="assertive"
      icon="pause"
      title={copy.title}
      action={<Button label={copy.action} kind="primary" loading={resuming} onPress={onResume} />}
    >
      {copy.body}
    </Notice>
  );
}
