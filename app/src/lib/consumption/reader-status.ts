import type { SaveStatusState } from './handoff-copy';

/** Display only: idle is not a server acknowledgment, and the latest page may
 * still be waiting for the save debounce or an edition acknowledgment. */
export function readerSaveIndicator(
  state: 'idle' | 'saving' | 'saved' | 'offline' | 'error',
  canSave: boolean,
  pendingEdition: boolean,
  editionState?: 'saved' | 'offline' | 'error',
): SaveStatusState | 'idle' {
  if (!canSave) return 'paused';
  if (pendingEdition) return 'saving';
  if (state === 'error' || editionState === 'error') return 'error';
  if (state === 'saving') return 'saving';
  if (state === 'offline' || editionState === 'offline') return 'on-device';
  return state;
}
