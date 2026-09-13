import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import {
  applyPlaybackRate,
  clampAudioPosition,
  resumedProgressLabel,
} from '@/lib/consumption/consumption';
import { APIError, api, errorMessage } from '@/lib/api';
import { reconcileOfflineRepresentationStates } from '@/lib/offline-library';
import { reconcilePendingProgress } from '@/lib/progress-outbox';
import type { ConsumptionState } from './useConsumptionState';
import type { useConsumptionActions } from './useConsumptionActions';

export function useConsumptionSync(
  state: ConsumptionState,
  actions: ReturnType<typeof useConsumptionActions>,
) {
  const {
    work,
    mode,
    audioID,
    audioState,
    source,
    initialAudioMS,
    setInitialAudioMS,
    setSyncAvailable,
    audioReady,
    setAudioReady,
    setNotice,
    editionConflictRef,
    mediaLoading,
    restoredAudio: restoredAudioRef,
    pendingAudioHandoff: pendingAudioHandoffRef,
    lastAudioSave: lastAudioSaveRef,
    representationSaves: representationSavesRef,
    audioSaves: audioSavesRef,
    switching: switchingRef,
    selectedEPUB,
    selectedAudio,
    player,
    status,
    audioDuration,
    alignmentID,
    setProgress,
    progressRef,
    setSaveState,
    setResumeMessage,
    progressConflictRef,
    updateProgressConflict,
    canonicalSaves: canonicalSavesRef,
    isCurrentReader,
    readerLocation,
    readerCommit,
    queueReaderRestore,
    showEditionConflict,
  } = state;
  const { saveEPUBLocation, saveReadingCursor, saveListeningPosition } = actions;

  useEffect(() => {
    if (!work) return;
    const workID = work.id;
    let active = true;
    let refreshing = false;
    async function refreshProgress() {
      if (refreshing || switchingRef.current) return;
      refreshing = true;
      const pending = canonicalSavesRef.current;
      try {
        await pending;
        await Promise.all([representationSavesRef.current, audioSavesRef.current]);
        if (!active || editionConflictRef.current || progressConflictRef.current) return;
        const editionConflicts = await reconcileOfflineRepresentationStates(workID);
        if (!active || !isCurrentReader()) return;
        const edition = editionConflicts.find(
          (item) => item.workID === workID && item.kind === (mode === 'read' ? 'epub' : 'audio'),
        );
        if (edition) {
          showEditionConflict(edition);
          return;
        }
        const queued = await reconcilePendingProgress(workID);
        if (queued) {
          updateProgressConflict({
            local: {
              alignment_id: queued.local.alignment_id,
              segment_id: queued.local.segment_id,
              offset: queued.local.offset,
            },
            remote: queued.remote,
          });
          setSaveState('error');
          return;
        }
        const next = await api.workProgress(workID);
        if (
          !active ||
          canonicalSavesRef.current !== pending ||
          !next ||
          (next.revision ?? 0) <= (progressRef.current?.revision ?? 0)
        )
          return;
        progressRef.current = next;
        setProgress(next);
        if (!next.resolvable || next.alignment_id !== alignmentID) return;
        let audioTimestampMS: number | undefined;
        if (mode === 'read') {
          const target = await api.canonicalToEPUB(alignmentID, next);
          if (
            !active ||
            !isCurrentReader() ||
            canonicalSavesRef.current !== pending ||
            progressRef.current !== next
          )
            return;
          queueReaderRestore(target);
        } else {
          const target = await api.canonicalToAudio(alignmentID, next);
          if (
            !active ||
            !isCurrentReader() ||
            canonicalSavesRef.current !== pending ||
            progressRef.current !== next
          )
            return;
          restoredAudioRef.current = '';
          setAudioReady(false);
          setInitialAudioMS(target.timestamp_ms);
          audioTimestampMS = target.timestamp_ms;
        }
        setSyncAvailable(true);
        setResumeMessage(
          resumedProgressLabel(
            next.source_device,
            audioTimestampMS == null ? undefined : audioTimestampMS / 1000,
          ),
        );
      } catch (error) {
        if (active && !(error instanceof APIError && error.status === 0))
          setNotice(errorMessage(error));
      } finally {
        refreshing = false;
      }
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshProgress();
    });
    const timer = setInterval(() => {
      if (Platform.OS === 'web' || AppState.currentState === 'active') void refreshProgress();
    }, 10_000);
    const onFocus = () => void refreshProgress();
    if (Platform.OS === 'web') window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', onFocus);
    };
  }, [
    audioSavesRef,
    editionConflictRef,
    representationSavesRef,
    restoredAudioRef,
    setAudioReady,
    setInitialAudioMS,
    setNotice,
    setSyncAvailable,
    switchingRef,
    work,
    alignmentID,
    mode,
    queueReaderRestore,
    isCurrentReader,
    showEditionConflict,
    updateProgressConflict,
    canonicalSavesRef,
    progressConflictRef,
    progressRef,
    setProgress,
    setResumeMessage,
    setSaveState,
  ]);

  useEffect(() => {
    if (mode !== 'listen' || mediaLoading || !source) return;
    if (!status.isLoaded) return;
    if (initialAudioMS == null) return;
    if (audioDuration <= 0) return;
    if (restoredAudioRef.current === `${audioID}:${initialAudioMS}`) return;
    void (async () => {
      try {
        await player.seekTo(clampAudioPosition(initialAudioMS / 1000, audioDuration), 0, 0);
        applyPlaybackRate(player, audioState?.playback_speed);
        restoredAudioRef.current = `${audioID}:${initialAudioMS}`;
        setAudioReady(true);
        const handoff = pendingAudioHandoffRef.current;
        if (handoff?.audioID !== audioID || handoff.timestampMS !== initialAudioMS) return;
        pendingAudioHandoffRef.current = undefined;
        player.play();
      } catch (error) {
        const handoff = pendingAudioHandoffRef.current;
        if (handoff?.audioID === audioID && handoff.timestampMS === initialAudioMS) {
          pendingAudioHandoffRef.current = undefined;
        }
        setAudioReady(false);
        setNotice(errorMessage(error));
      }
    })();
  }, [
    pendingAudioHandoffRef,
    restoredAudioRef,
    setAudioReady,
    setNotice,
    mode,
    mediaLoading,
    source,
    status.isLoaded,
    audioDuration,
    initialAudioMS,
    audioID,
    audioState?.playback_speed,
    player,
  ]);

  useEffect(() => {
    if (mode !== 'read' || !readerLocation || !selectedEPUB || readerLocation.reason === 'restore')
      return;
    const location = readerLocation;
    let saved = false;
    function save() {
      if (saved) return;
      saved = true;
      void saveEPUBLocation(location);
    }
    // A deliberate selection should not wait for the page-turn debounce.
    if (location.reason === 'explicit') save();
    const timer = setTimeout(save, 900);
    const subscription =
      Platform.OS === 'web'
        ? undefined
        : AppState.addEventListener('change', (state) => {
            if (state !== 'active') {
              clearTimeout(timer);
              save();
            }
          });
    return () => {
      clearTimeout(timer);
      subscription?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, readerLocation, selectedEPUB?.id, alignmentID]);

  useEffect(() => {
    if (mode === 'read' && readerCommit) void saveReadingCursor(readerCommit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, readerCommit]);

  useEffect(() => {
    if (
      mode !== 'listen' ||
      mediaLoading ||
      !source ||
      switchingRef.current ||
      !status.isLoaded ||
      (initialAudioMS != null && !audioReady) ||
      !selectedAudio
    )
      return;
    const timestamp = Math.round(status.currentTime * 1000);
    if (lastAudioSaveRef.current >= 0 && Math.abs(timestamp - lastAudioSaveRef.current) < 2000)
      return;
    lastAudioSaveRef.current = timestamp;
    void saveListeningPosition(timestamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    mediaLoading,
    source,
    status.currentTime,
    status.isLoaded,
    audioReady,
    selectedAudio?.id,
    alignmentID,
  ]);

  useEffect(() => {
    if (Platform.OS === 'web' || mode !== 'listen' || !status.isLoaded || !selectedAudio) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      const timestamp = Math.round(player.currentTime * 1000);
      lastAudioSaveRef.current = timestamp;
      void saveListeningPosition(timestamp);
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status.isLoaded, selectedAudio?.id, alignmentID]);
}
