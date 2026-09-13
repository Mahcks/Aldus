import { useCallback, useRef, useState, type RefObject } from 'react';
import { Platform } from 'react-native';
import type { CanonicalPosition, Work } from '@/generated/api';
import { APIError, api, errorMessage } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/api-base';
import { activeStorageScope } from '@/lib/storage-scope';
import {
  offlineWork,
  updateOfflineProgress,
  type RepresentationConflict,
} from '@/lib/offline-library';
import { discardPendingProgress, pendingProgress, saveWorkProgress } from '@/lib/progress-outbox';
import { useAcceptanceNetwork } from '@/maintainer/useAcceptanceNetwork';

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
type ProgressConflict = { local: CanonicalPosition; remote: CanonicalPosition };

export function useCanonicalProgress({
  work,
  alignmentID,
  editionConflictRef,
  setSyncAvailable,
  setNotice,
}: {
  work: Work | undefined;
  alignmentID: string | undefined;
  editionConflictRef: RefObject<RepresentationConflict | undefined>;
  setSyncAvailable: (available: boolean) => void;
  setNotice: (notice: string) => void;
}) {
  const [progress, setProgress] = useState<CanonicalPosition | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [resumeMessage, setResumeMessage] = useState('');
  const progressRef = useRef<CanonicalPosition | null>(null);
  const canonicalSaves = useRef<Promise<void>>(Promise.resolve());
  const saveAttempt = useRef(0);
  const [progressConflict, setProgressConflict] = useState<ProgressConflict>();
  const progressConflictRef = useRef<ProgressConflict | undefined>(undefined);
  const updateProgressConflict = useCallback((conflict: ProgressConflict | undefined) => {
    progressConflictRef.current = conflict;
    setProgressConflict(conflict);
  }, []);
  const [readerScope] = useState(activeStorageScope);
  const [readerOrigin] = useState(getAPIBaseURL);
  const isCurrentReader = useCallback(
    () => readerScope === activeStorageScope() && readerOrigin === getAPIBaseURL(),
    [readerScope, readerOrigin],
  );
  const acceptanceNetwork = useAcceptanceNetwork(work?.id, async (remote) => {
    if (!work) return;
    progressRef.current = remote;
    setProgress(remote);
    await updateOfflineProgress(work.id, remote);
    setSyncAvailable(true);
    setSaveState('saved');
    setNotice('');
  });
  async function saveCanonical(
    position: CanonicalPosition | (() => Promise<CanonicalPosition | undefined>),
  ): Promise<'saved' | 'offline' | false> {
    if (!work || !alignmentID || progressConflictRef.current || editionConflictRef.current)
      return false;
    const saveScope = readerScope;
    const saveOrigin = readerOrigin;
    const attempt = ++saveAttempt.current;
    setSaveState('saving');
    let saved: 'saved' | 'offline' | false = false;
    canonicalSaves.current = canonicalSaves.current
      .catch(() => {})
      .then(async () => {
        try {
          if (!isCurrentReader() || progressConflictRef.current || editionConflictRef.current)
            return;
          // Resolve inside the queue: a slow older lookup must not save after a
          // more recent selection simply because its response arrived later.
          const canonical = typeof position === 'function' ? await position() : position;
          if (!canonical) {
            if (attempt === saveAttempt.current) setSaveState('error');
            return;
          }
          if (!isCurrentReader() || progressConflictRef.current || editionConflictRef.current)
            return;
          if (Platform.OS !== 'web') {
            // Wait for replay, then adopt its acknowledgment only for the exact
            // place we already hold. A different cached place is not permission
            // to overwrite another device's progress.
            await pendingProgress(work.id, saveScope);
            const cached = (await offlineWork(work.id))?.progress;
            const previous = progressRef.current;
            if (!isCurrentReader() || progressConflictRef.current || editionConflictRef.current)
              return;
            if (
              cached &&
              previous &&
              cached.alignment_id === previous.alignment_id &&
              cached.segment_id === previous.segment_id &&
              cached.offset === previous.offset &&
              (cached.revision ?? 0) > (previous.revision ?? 0)
            ) {
              progressRef.current = cached;
            }
          }
          const current = progressRef.current;
          if (
            current?.alignment_id === alignmentID &&
            current.segment_id === canonical.segment_id &&
            current.offset === canonical.offset
          ) {
            saved = (await pendingProgress(work.id, saveScope)) ? 'offline' : 'saved';
            if (attempt === saveAttempt.current) setSaveState(saved);
            return;
          }
          const update = {
            alignment_id: alignmentID,
            segment_id: canonical.segment_id,
            offset: canonical.offset,
            expected_revision: progressRef.current?.revision ?? 0,
            source_device: Platform.OS,
          };
          let next: CanonicalPosition;
          try {
            const result = await saveWorkProgress(work.id, update, saveScope, saveOrigin);
            if (saveScope !== activeStorageScope() || saveOrigin !== getAPIBaseURL()) return;
            if (!result) {
              const local = {
                ...progressRef.current,
                ...canonical,
                alignment_id: alignmentID,
              };
              progressRef.current = local;
              setProgress(local);
              await updateOfflineProgress(work.id, local);
              saved = 'offline';
              if (attempt === saveAttempt.current) setSaveState('offline');
              if (process.env.EXPO_PUBLIC_ALDUS_IOS_ACCEPTANCE === '1')
                acceptanceNetwork.markQueued();
              return;
            }
            next = result;
          } catch (error) {
            if (!(error instanceof APIError && error.status === 409)) throw error;
            if (!isCurrentReader()) return;
            const latest = await api.workProgress(work.id);
            if (!latest) throw error;
            if (!isCurrentReader()) return;
            progressRef.current = latest;
            setProgress(latest);
            updateProgressConflict({ local: canonical, remote: latest });
            setSaveState('error');
            return;
          }
          progressRef.current = next;
          await updateOfflineProgress(work.id, next);
          setProgress(next);
          setSyncAvailable(true);
          setResumeMessage('');
          saved = 'saved';
          if (attempt === saveAttempt.current) setSaveState('saved');
        } catch (error) {
          if (attempt === saveAttempt.current) setSaveState('error');
          if (error instanceof APIError && error.status === 409)
            setNotice(
              'Progress changed again on another device. Move once more to save this place.',
            );
          else if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
          else setNotice(errorMessage(error));
        }
      })
      .catch((error) => {
        if (attempt === saveAttempt.current) setSaveState('error');
        setNotice(errorMessage(error));
      });
    await canonicalSaves.current;
    return saved;
  }

  async function keepLocalProgress() {
    if (!progressConflict || !work || !alignmentID) return;
    const local = progressConflict.local;
    try {
      const saved = await api.updateWorkProgress(work.id, {
        alignment_id: alignmentID,
        segment_id: local.segment_id,
        offset: local.offset,
        expected_revision: progressConflict.remote.revision ?? 0,
        source_device: Platform.OS,
      });
      await discardPendingProgress(work.id);
      progressRef.current = saved;
      setProgress(saved);
      await updateOfflineProgress(work.id, saved);
      updateProgressConflict(undefined);
      setSaveState('saved');
    } catch (error) {
      setSaveState('error');
      setNotice(errorMessage(error));
    }
  }

  return {
    progress,
    setProgress,
    progressRef,
    saveState,
    setSaveState,
    resumeMessage,
    setResumeMessage,
    progressConflict,
    progressConflictRef,
    updateProgressConflict,
    canonicalSaves,
    saveCanonical,
    keepLocalProgress,
    readerScope,
    readerOrigin,
    isCurrentReader,
    acceptanceNetwork,
  };
}
