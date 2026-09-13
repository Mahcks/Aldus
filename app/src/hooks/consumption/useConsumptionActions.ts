import { activeStorageScope } from '@/lib/storage-scope';
import type { AudioLocator, CanonicalPosition } from '@/generated/api';
import { Platform } from 'react-native';
import { type ReaderLocation } from '@/components/consumption/reader/EPUBReader';
import { commitsReadingProgress } from '@/components/consumption/reader/reader-location';
import {
  listenToRead,
  playbackRate,
  queueTask,
  resumedProgressLabel,
  readToListen,
} from '@/lib/consumption/consumption';
import { representationStateUpdate } from '@/lib/consumption/offline-representation';
import { APIError, api, errorMessage } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/api-base';
import { goBackOr } from '@/lib/navigation';
import {
  acknowledgeOfflineRepresentationState,
  updateOfflineProgress,
} from '@/lib/offline-library';
import {
  offlineAudioToCanonical,
  offlineCanonicalToAudio,
  offlineCanonicalToEPUB,
  offlineEPUBToCanonical,
} from '@/lib/consumption/offline-position';
import { discardPendingProgress } from '@/lib/progress-outbox';
import type { ConsumptionState, ConsumptionPanels, ConsumptionParams } from './useConsumptionState';

export function useConsumptionActions(
  state: ConsumptionState,
  panels: ConsumptionPanels,
  params: ConsumptionParams,
) {
  const {
    work,
    mode,
    setMode,
    audioID,
    alignment,
    setEPUBState,
    setAudioState,
    setInitialAudioMS,
    setSyncAvailable,
    setAudioReady,
    setNotice,
    setModeSwitching,
    setEditionConflict,
    editionConflictRef,
    resolvingEditionConflict,
    setResolvingEditionConflict,
    restoredAudio: restoredAudioRef,
    pendingAudioHandoff: pendingAudioHandoffRef,
    lastAudioSave: lastAudioSaveRef,
    representationSaves: representationSavesRef,
    audioSaves: audioSavesRef,
    representationSaveAttempt: representationSaveAttemptRef,
    switching: switchingRef,
    leaving: leavingRef,
    selectedEPUB,
    selectedAudio,
    player,
    status,
    setCurrentPlaybackRate,
    alignmentID,
    setProgress,
    progressRef,
    setSaveState,
    setResumeMessage,
    progressConflict,
    progressConflictRef,
    updateProgressConflict,
    canonicalSaves: canonicalSavesRef,
    saveCanonical,
    readerScope,
    readerOrigin,
    isCurrentReader,
    readerLocation,
    reader,
    readerInputBlocked: readerInputBlockedRef,
    queueReaderRestore,
    applyEditionPreferences,
    showEditionConflict,
    epubStateRef,
    audioStateRef,
    saveRepresentation,
    formatSwitchBusy,
  } = state;
  const restoredAudio = restoredAudioRef;
  const pendingAudioHandoff = pendingAudioHandoffRef;
  const lastAudioSave = lastAudioSaveRef;
  const representationSaves = representationSavesRef;
  const audioSaves = audioSavesRef;
  const representationSaveAttempt = representationSaveAttemptRef;
  const switching = switchingRef;
  const leaving = leavingRef;
  const canonicalSaves = canonicalSavesRef;
  const readerInputBlocked = readerInputBlockedRef;
  const { setSettingsOpen, setContentsOpen, setReaderSearchOpen } = panels;

  async function openReaderLocation(location: unknown) {
    try {
      if (!(await reader.current?.navigate(location))) {
        setNotice('That location is unavailable in this ebook.');
        return;
      }
      setContentsOpen(false);
      setReaderSearchOpen(false);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function saveEPUBLocation(location: ReaderLocation) {
    // Opening a book reads its saved position; it must not replace that position.
    if (readerInputBlocked.current || location.reason === 'restore') return false;
    const saveScope = readerScope;
    const saveOrigin = readerOrigin;
    const attempt = ++representationSaveAttempt.current;
    if (!alignmentID || !progressRef.current?.alignment_id) setSaveState('saving');
    let result: 'saved' | 'offline' | 'error' = 'error';
    representationSaves.current = representationSaves.current
      .catch(() => {})
      .then(async () => {
        if (saveScope !== activeStorageScope() || saveOrigin !== getAPIBaseURL()) return;
        result = await saveRepresentation('epub', {
          href: location.href,
          cfi: location.cfi,
          totalProgression: location.totalProgression,
        });
        if (attempt === representationSaveAttempt.current) {
          if ((!alignmentID || !progressRef.current?.alignment_id) && !progressConflictRef.current)
            setSaveState(result);
          if (result !== 'error' && location.reason === 'explicit' && !alignmentID) {
            reader.current?.confirmSavedPlace?.(location, result);
          }
        }
      });
    await representationSaves.current;
    return result !== 'error';
  }

  async function restoreCanonical(next: CanonicalPosition) {
    if (!alignmentID || !next.resolvable || next.alignment_id !== alignmentID) return;
    if (mode === 'read') queueReaderRestore(await api.canonicalToEPUB(alignmentID, next));
    else {
      const target = await api.canonicalToAudio(alignmentID, next);
      restoredAudio.current = '';
      setAudioReady(false);
      setInitialAudioMS(target.timestamp_ms);
    }
  }

  async function acceptRemoteProgress() {
    if (!progressConflict || !work) return;
    const remote = progressConflict.remote;
    await discardPendingProgress(work.id);
    progressRef.current = remote;
    setProgress(remote);
    await updateOfflineProgress(work.id, remote);
    updateProgressConflict(undefined);
    setSaveState('saved');
    await restoreCanonical(remote);
    setResumeMessage(resumedProgressLabel(remote.source_device));
  }

  async function resolveEditionConflict(keepLocal: boolean) {
    const conflict = editionConflictRef.current;
    if (!conflict || resolvingEditionConflict || !isCurrentReader()) return;
    setResolvingEditionConflict(true);
    try {
      const chosen = keepLocal
        ? await api.updateRepresentationState(
            conflict.local.representation_id,
            representationStateUpdate(conflict.local, conflict.remote.revision),
          )
        : await api.representationState(conflict.local.representation_id);
      if (!chosen || !isCurrentReader()) return;
      await acknowledgeOfflineRepresentationState(
        conflict.workID,
        conflict.kind,
        conflict.local,
        chosen,
        keepLocal,
      );
      if (!isCurrentReader()) return;
      if (conflict.kind === 'epub') {
        epubStateRef.current = chosen;
        setEPUBState(chosen);
        applyEditionPreferences(chosen, false);
        if (!progressRef.current?.resolvable) queueReaderRestore(chosen.epub_locator);
      } else {
        audioStateRef.current = chosen;
        setAudioState(chosen);
        setCurrentPlaybackRate(playbackRate(chosen.playback_speed));
        if (!progressRef.current?.resolvable) {
          restoredAudio.current = '';
          setAudioReady(false);
          setInitialAudioMS(chosen.audio_timestamp_ms);
        }
      }
      editionConflictRef.current = undefined;
      setEditionConflict(undefined);
      setSaveState('saved');
    } catch (error) {
      if (error instanceof APIError && error.status === 409 && isCurrentReader()) {
        try {
          const remote = await api.representationState(conflict.local.representation_id);
          if (remote && isCurrentReader()) showEditionConflict({ ...conflict, remote });
        } catch (refreshError) {
          setNotice(errorMessage(refreshError));
        }
      } else if (isCurrentReader()) setNotice(errorMessage(error));
    } finally {
      setResolvingEditionConflict(false);
    }
  }

  async function saveReadingCursor(location: ReaderLocation) {
    if (
      readerInputBlocked.current ||
      switching.current ||
      !alignmentID ||
      !location.sync ||
      !commitsReadingProgress(location.reason)
    )
      return;
    const locator = location.sync;
    const result = await saveCanonical(async () => {
      try {
        return await api.epubToCanonical(alignmentID, locator);
      } catch (error) {
        if (error instanceof APIError && error.status === 0)
          return offlineEPUBToCanonical(alignmentID, locator);
        throw error;
      }
    });
    if (result && location.reason === 'explicit')
      reader.current?.confirmSavedPlace?.(location, result);
    return result;
  }

  async function saveListeningPosition(timestampMS: number, speed = status.playbackRate || 1) {
    const currentAlignmentID = switching.current ? undefined : alignmentID;
    const currentAlignment = switching.current ? undefined : alignment;
    const audioResource = currentAlignment?.segments[0]?.audio_resource;
    let saved = false;
    audioSaves.current = queueTask(audioSaves.current, async () => {
      if (!isCurrentReader()) return;
      const result = await saveRepresentation('audio', timestampMS, speed);
      if (result === 'error') return;
      if (!currentAlignmentID) {
        saved = true;
        return;
      }
      if (!currentAlignment || !audioResource) return;
      const locator: AudioLocator = {
        resource: audioResource,
        timestamp_ms: timestampMS,
      };
      try {
        saved = Boolean(
          await saveCanonical(await api.audioToCanonical(currentAlignmentID, locator)),
        );
      } catch (error) {
        if (error instanceof APIError && error.status === 0) {
          const canonical = offlineAudioToCanonical(currentAlignment, locator);
          if (canonical) saved = Boolean(await saveCanonical(canonical));
        } else if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
        else setNotice(errorMessage(error));
      }
    });
    await audioSaves.current;
    return saved;
  }

  async function switchToListen(location = readerLocation) {
    if (
      readerInputBlocked.current ||
      switching.current ||
      progressConflictRef.current ||
      editionConflictRef.current
    )
      return;
    if (!work || !location?.sync || !alignmentID)
      return setNotice(
        'Listening can\u2019t start here. Your reading position is saved; select narration text and choose Listen from here.',
      );
    switching.current = true;
    setModeSwitching(true);
    try {
      await saveEPUBLocation(location);
      await canonicalSaves.current;
      const { progress: next, target } = await readToListen(
        api,
        work.id,
        alignmentID,
        location.sync,
        progressRef.current?.revision ?? 0,
        Platform.OS,
      );
      if (__DEV__)
        console.debug('Aldus Read → Listen', {
          href: location.sync.href,
          locator: location.sync.locator,
          canonical: { segment_id: next.segment_id, offset: next.offset },
          audio_timestamp_ms: target.timestamp_ms,
        });
      progressRef.current = next;
      setProgress(next);
      setAudioReady(false);
      pendingAudioHandoff.current = { audioID, timestampMS: target.timestamp_ms };
      restoredAudio.current = '';
      setInitialAudioMS(target.timestamp_ms);
      setMode('listen');
      setNotice('');
    } catch (error) {
      pendingAudioHandoff.current = undefined;
      if (error instanceof APIError && error.status === 0 && alignment) {
        const canonical = offlineEPUBToCanonical(alignmentID, location.sync);
        const target = canonical && offlineCanonicalToAudio(alignment, canonical);
        if (canonical && target) {
          await saveCanonical(canonical);
          setAudioReady(false);
          pendingAudioHandoff.current = { audioID, timestampMS: target.timestamp_ms };
          restoredAudio.current = '';
          setInitialAudioMS(target.timestamp_ms);
          setMode('listen');
          setNotice('Offline mode · changes will sync when Aldus is reachable.');
          return;
        }
      }
      if (error instanceof APIError && error.status === 409) {
        const current = await api.workProgress(work.id);
        progressRef.current = current;
        setProgress(current);
        setNotice('Progress changed on another device. The newer saved position was kept.');
      } else {
        setSyncAvailable(false);
        setNotice(
          error instanceof APIError && error.status === 404
            ? 'Listening can\u2019t start here. Your reading position is saved; select narration text and choose Listen from here.'
            : errorMessage(error),
        );
      }
    } finally {
      switching.current = false;
      setModeSwitching(false);
    }
  }

  async function leaveReader() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (
        mode === 'read' &&
        readerLocation &&
        selectedEPUB &&
        !readerInputBlocked.current &&
        readerLocation.reason !== 'restore'
      ) {
        if (!(await saveEPUBLocation(readerLocation))) {
          setNotice('Your latest place could not be saved. Please try again before closing.');
          return;
        }
        if (alignmentID && readerLocation.sync && commitsReadingProgress(readerLocation.reason)) {
          if (!(await saveReadingCursor(readerLocation))) {
            setNotice('Your reading place could not be synced. Please try again before closing.');
            return;
          }
        }
      } else if (mode === 'listen' && status.isLoaded && selectedAudio) {
        const timestamp = Math.round(player.currentTime * 1000);
        lastAudioSave.current = timestamp;
        if (!(await saveListeningPosition(timestamp))) {
          setNotice('Your latest place could not be saved. Please try again before closing.');
          return;
        }
      }
      await canonicalSaves.current;
      goBackOr(`/work/${params.id}`);
    } finally {
      leaving.current = false;
    }
  }

  async function switchToRead() {
    if (switching.current || progressConflictRef.current || editionConflictRef.current) return;
    pendingAudioHandoff.current = undefined;
    if (!work || !alignmentID || !alignment?.segments[0])
      return setNotice('Synchronized reading is unavailable at this point.');
    switching.current = true;
    setModeSwitching(true);
    try {
      await audioSaves.current;
      await canonicalSaves.current;
      const timestampMS = Math.round(player.currentTime * 1000);
      const { progress: next, target } = await listenToRead(
        api,
        work.id,
        alignmentID,
        {
          resource: alignment.segments[0].audio_resource,
          timestamp_ms: timestampMS,
        },
        progressRef.current?.revision ?? 0,
        Platform.OS,
      );
      if (__DEV__)
        console.debug('Aldus Listen → Read', {
          audio_timestamp_ms: timestampMS,
          canonical: { segment_id: next.segment_id, offset: next.offset },
          epub: target,
        });
      progressRef.current = next;
      setProgress(next);
      player.pause();
      queueReaderRestore(target);
      setMode('read');
      setNotice('');
      setSyncAvailable(true);
    } catch (error) {
      if (error instanceof APIError && error.status === 0 && alignment) {
        const canonical = offlineAudioToCanonical(alignment, {
          resource: alignment.segments[0].audio_resource,
          timestamp_ms: Math.round(player.currentTime * 1000),
        });
        const target = canonical && offlineCanonicalToEPUB(alignment, canonical);
        if (canonical && target) {
          await saveCanonical(canonical);
          player.pause();
          queueReaderRestore(target);
          setMode('read');
          setNotice('Offline mode · changes will sync when Aldus is reachable.');
          setSyncAvailable(true);
          return;
        }
      }
      if (error instanceof APIError && error.status === 409) {
        const current = await api.workProgress(work.id);
        progressRef.current = current;
        setProgress(current);
        setNotice('Progress changed on another device. The newer saved position was kept.');
      } else {
        setSyncAvailable(false);
        setNotice(
          error instanceof APIError && error.status === 404
            ? 'Synchronized reading is unavailable at this point.'
            : errorMessage(error),
        );
      }
    } finally {
      switching.current = false;
      setModeSwitching(false);
    }
  }

  async function handleReadMode() {
    if (formatSwitchBusy || switching.current) return;
    if (mode === 'listen' && alignmentID && status.isLoaded) {
      await switchToRead();
      return;
    }
    switching.current = true;
    try {
      if (mode === 'listen' && status.isLoaded && selectedAudio) {
        const timestamp = Math.round(player.currentTime * 1000);
        lastAudioSave.current = timestamp;
        if (!(await saveListeningPosition(timestamp))) {
          setNotice('Your latest place could not be saved. Please try again before switching.');
          return;
        }
      }
      pendingAudioHandoff.current = undefined;
      setMode('read');
    } finally {
      switching.current = false;
    }
  }

  async function handleListenMode() {
    if (formatSwitchBusy || switching.current) return;
    setSettingsOpen(false);
    if (mode === 'read' && readerLocation?.sync && alignmentID) {
      await switchToListen();
      return;
    }
    switching.current = true;
    try {
      if (
        mode === 'read' &&
        readerLocation &&
        !readerInputBlocked.current &&
        readerLocation.reason !== 'restore' &&
        !(await saveEPUBLocation(readerLocation))
      ) {
        setNotice('Your latest place could not be saved. Please try again before switching.');
        return;
      }
      pendingAudioHandoff.current = undefined;
      setMode('listen');
    } finally {
      switching.current = false;
    }
  }
  return {
    openReaderLocation,
    saveEPUBLocation,
    restoreCanonical,
    acceptRemoteProgress,
    resolveEditionConflict,
    saveReadingCursor,
    saveListeningPosition,
    switchToListen,
    leaveReader,
    switchToRead,
    handleReadMode,
    handleListenMode,
  };
}
