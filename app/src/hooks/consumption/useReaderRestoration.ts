import type { CanonicalPosition } from '@/generated/api';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type EPUBReaderHandle,
  type ReaderLocation,
  type ReaderNavigationItem,
} from '@/components/consumption/reader/EPUBReader';
import { commitsReadingProgress } from '@/components/consumption/reader/reader-location';

import { readerControlsReady } from '@/lib/consumption/consumption';

export function useReaderRestoration({
  mode,
  mediaLoading,
  progress,
  alignmentID,
  setSyncAvailable,
}: {
  mode: 'read' | 'listen';
  mediaLoading: boolean;
  progress: CanonicalPosition | null;
  alignmentID: string | undefined;
  setSyncAvailable: (available: boolean) => void;
}) {
  const [readerLocation, setReaderLocation] = useState<ReaderLocation>();
  const [readerTarget, setReaderTarget] = useState<unknown>();
  const [readerCommit, setReaderCommit] = useState<ReaderLocation>();
  const [readerRestoring, setReaderRestoring] = useState(true);
  const [readerContents, setReaderContents] = useState<ReaderNavigationItem[]>([]);
  const [readerNavigationReady, setReaderNavigationReady] = useState(false);
  const reader = useRef<EPUBReaderHandle>(null);
  const readerReady = useRef(false);

  // Block callbacks immediately, before React renders the loading cover.
  const readerInputBlocked = useRef(true);

  const pendingReaderLocation = useRef<ReaderLocation | undefined>(undefined);
  const [readerRestoreError, setReaderRestoreError] = useState(false);
  const restoredReaderTarget = useRef<unknown>(undefined);
  const restoringReaderTarget = useRef<unknown>(undefined);
  const readerInteractionReady = readerControlsReady(
    readerNavigationReady,
    mediaLoading,
    readerRestoring,
    Boolean(readerLocation),
  );

  const queueReaderRestore = useCallback((target: unknown) => {
    if (target && readerReady.current && restoredReaderTarget.current === target) return;
    readerInputBlocked.current = true;
    pendingReaderLocation.current = undefined;
    restoringReaderTarget.current = undefined;
    setReaderRestoreError(false);
    setReaderCommit(undefined);
    setReaderLocation(undefined);
    setReaderRestoring(true);
    setReaderTarget(target);
  }, []);

  const resetReaderPublication = useCallback(() => {
    queueReaderRestore(undefined);
    readerReady.current = false;
    setReaderNavigationReady(false);
    setReaderContents([]);
    restoredReaderTarget.current = undefined;
    restoringReaderTarget.current = undefined;
  }, [queueReaderRestore]);

  const prepareReaderPublication = useCallback((reusePublication: boolean) => {
    readerInputBlocked.current = true;
    pendingReaderLocation.current = undefined;
    setReaderRestoreError(false);
    setReaderRestoring(true);
    // Cached and server metadata may arrive separately for the same mounted publication.
    if (!reusePublication) {
      readerReady.current = false;
      setReaderNavigationReady(false);
      setReaderContents([]);
    }
  }, []);

  const releaseReaderPublication = useCallback(() => {
    readerReady.current = false;
    setReaderNavigationReady(false);
    restoredReaderTarget.current = undefined;
  }, []);

  const restoreExactPosition = Boolean(
    progress?.resolvable && progress.alignment_id === alignmentID,
  );

  const restoreReader = useCallback(
    async (target: unknown) => {
      if (!readerReady.current || !target || restoringReaderTarget.current === target) return;
      if (restoredReaderTarget.current === target) {
        readerInputBlocked.current = false;
        setReaderRestoring(false);
        return;
      }
      readerInputBlocked.current = true;
      setReaderRestoreError(false);
      restoringReaderTarget.current = target;
      setReaderRestoring(true);
      let restored = false;
      try {
        for (
          let attempt = 0;
          attempt < 3 && readerReady.current && restoringReaderTarget.current === target;
          attempt += 1
        ) {
          restored = Boolean(await reader.current?.restoreLocation(target, restoreExactPosition));
          if (restored) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        if (__DEV__) console.error('Aldus could not restore the EPUB position.', error);
      }
      if (restoringReaderTarget.current !== target) return;
      restoringReaderTarget.current = undefined;
      if (restored) {
        restoredReaderTarget.current = target;
        readerInputBlocked.current = false;
        const location = pendingReaderLocation.current;
        pendingReaderLocation.current = undefined;
        if (location) {
          setReaderLocation({ ...location, reason: 'restore' });
          setSyncAvailable(Boolean(location.sync));
        }
        setReaderRestoring(false);
      } else {
        setReaderRestoreError(true);
      }
    },
    [restoreExactPosition, setSyncAvailable],
  );

  const onReaderLocation = useCallback(
    (location: ReaderLocation) => {
      if (readerInputBlocked.current) {
        pendingReaderLocation.current = location;
        return;
      }
      setReaderLocation(location);
      if (commitsReadingProgress(location.reason)) setReaderCommit(location);
      setSyncAvailable(Boolean(location.sync));
    },
    [setSyncAvailable],
  );

  const onReaderReady = useCallback((contents: ReaderNavigationItem[]) => {
    readerReady.current = true;
    setReaderNavigationReady(true);
    setReaderContents(contents);
  }, []);

  useEffect(() => {
    if (mode === 'read' && readerInteractionReady) reader.current?.revealRestoredPlace?.();
  }, [mode, readerInteractionReady]);

  useEffect(() => {
    if (readerRestoreError) return;
    if (mode !== 'read' || mediaLoading || !readerNavigationReady || !readerReady.current) return;
    if (!readerTarget || restoredReaderTarget.current === readerTarget) {
      readerInputBlocked.current = false;
      if (pendingReaderLocation.current) {
        setReaderLocation({ ...pendingReaderLocation.current, reason: 'restore' });
        setSyncAvailable(Boolean(pendingReaderLocation.current.sync));
        pendingReaderLocation.current = undefined;
      }
      setReaderRestoring(false);
      return;
    }
    void restoreReader(readerTarget);
  }, [
    mediaLoading,
    mode,
    readerNavigationReady,
    readerRestoreError,
    readerTarget,
    restoreReader,
    setSyncAvailable,
  ]);
  return {
    reader,
    readerLocation,
    readerTarget,
    readerCommit,
    readerContents,
    readerInputBlocked,
    readerRestoreError,
    setReaderRestoreError,
    readerInteractionReady,
    canRetryRestore: readerNavigationReady,
    queueReaderRestore,
    restoreReader,
    resetReaderPublication,
    prepareReaderPublication,
    releaseReaderPublication,
    onReaderLocation,
    onReaderReady,
  };
}
