import { useState } from 'react';
import type { CanonicalPosition } from '@/generated/api';
import { APIError, api } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/api-base';
import { pendingProgress, reconcilePendingProgress } from '@/lib/progress-outbox';

const ACCEPTANCE_NETWORK_LABELS = {
  idle: 'Toggle acceptance network',
  busy: 'Changing acceptance network…',
  disconnected: 'Acceptance network disconnected',
  queued: 'Acceptance progress queued',
  reconciled: 'Acceptance progress reconciled',
  missing: 'Acceptance failed: queued progress missing',
  conflict: 'Acceptance failed: queued progress conflicted',
  mismatch: 'Acceptance failed: server position mismatch',
  failed: 'Acceptance failed: network or server request',
} as const;

export function useAcceptanceNetwork(
  workID: string | undefined,
  onReconciled: (progress: CanonicalPosition) => Promise<void>,
) {
  const [acceptanceNetworkState, setAcceptanceNetworkState] =
    useState<keyof typeof ACCEPTANCE_NETWORK_LABELS>('idle');
  async function toggleAcceptanceNetwork() {
    setAcceptanceNetworkState('busy');
    try {
      const queued = workID ? await pendingProgress(workID) : null;
      const response = await fetch(`${getAPIBaseURL()}/__acceptance/network/toggle`, {
        method: 'POST',
      });
      const network = response.headers.get('X-Aldus-Acceptance-Network');
      if (!response.ok || (network !== 'on' && network !== 'off')) throw new Error();
      if (network === 'off') {
        setAcceptanceNetworkState('disconnected');
        return;
      }
      if (!workID || !queued) {
        setAcceptanceNetworkState('missing');
        return;
      }
      if (await reconcilePendingProgress(workID)) {
        setAcceptanceNetworkState('conflict');
        return;
      }
      const remote = await api.workProgress(workID);
      if (
        !remote ||
        remote.alignment_id !== queued.alignment_id ||
        remote.segment_id !== queued.segment_id ||
        remote.offset !== queued.offset
      ) {
        setAcceptanceNetworkState('mismatch');
        return;
      }
      await onReconciled(remote);
      setAcceptanceNetworkState('reconciled');
    } catch (error) {
      setAcceptanceNetworkState(
        error instanceof APIError && error.status === 409 ? 'conflict' : 'failed',
      );
    }
  }

  return {
    label: ACCEPTANCE_NETWORK_LABELS[acceptanceNetworkState],
    busy: acceptanceNetworkState === 'busy',
    toggle: toggleAcceptanceNetwork,
    markQueued: () => setAcceptanceNetworkState('queued'),
  };
}
