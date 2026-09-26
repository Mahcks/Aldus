import { StatusBadge } from '@/components/ui';
import {
  saveStatusView,
  syncReadinessView,
  type SaveStatusState,
  type SyncReadinessState,
} from '@/lib/consumption/handoff-copy';

/** Where this device's place lives: on the server, only here, or not being saved. */
export function ProgressStatus({
  state,
  mode,
}: {
  state: SaveStatusState;
  mode: 'read' | 'listen';
}) {
  const view = saveStatusView(state, mode);

  return <StatusBadge tone={view.tone} label={view.label} icon={view.icon} />;
}

/** Whether ebook and audiobook can follow each other. Independent of which device is active. */
export function SyncReadiness({ state }: { state: SyncReadinessState }) {
  const view = syncReadinessView(state);

  return <StatusBadge tone={view.tone} label={view.label} icon={view.icon} />;
}
