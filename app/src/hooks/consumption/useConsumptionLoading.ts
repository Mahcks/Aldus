import { loadConsumptionWork } from '@/lib/consumption/load-work';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import {
  canonicalResumeTargets,
  pendingCanonicalProgress,
  playbackRate,
  reusesReaderPublication,
  resumedProgressLabel,
  readyJob,
  shouldLoadConsumptionMedia,
} from '@/lib/consumption/consumption';
import { APIError, api, errorMessage } from '@/lib/api';
import { cachedReaderPreferences, cacheReaderPreferences } from '@/lib/reader-preferences-cache';
import { productEPUBSource } from '@/lib/epub-source';
import { productAudioSource } from '@/lib/media';
import { offlineWork, reconcileOfflineRepresentationStates } from '@/lib/offline-library';
import { pendingProgress } from '@/lib/progress-outbox';
import type { ConsumptionState, ConsumptionParams, ConsumptionPanels } from './useConsumptionState';

export function useConsumptionLoading(
  state: ConsumptionState,
  params: ConsumptionParams,
  panels: ConsumptionPanels,
) {
  const {
    work,
    setWork,
    mode,
    setEPUBs,
    setAudio,
    setAudioChapters,
    epubID,
    setEPUBID,
    audioID,
    setAudioID,
    jobs,
    setJobs,
    alignment,
    setAlignment,
    setEPUBState,
    setAudioState,
    epubSource,
    setEPUBSource,
    source,
    setSource,
    setInitialAudioMS,
    setSyncAvailable,
    setAudioReady,
    setNotice,
    setEditionConflict,
    editionConflictRef,
    setLoading,
    setMediaLoading,
    epubSourceID: epubSourceIDRef,
    audioSourceID: audioSourceIDRef,
    restoredAudio: restoredAudioRef,
    pendingAudioHandoff: pendingAudioHandoffRef,
    selectedEPUB,
    selectedAudio,
    setCurrentPlaybackRate,
    progress,
    setProgress,
    progressRef,
    setSaveState,
    setResumeMessage,
    setReaderRestoreError,
    queueReaderRestore,
    resetReaderPublication,
    prepareReaderPublication,
    releaseReaderPublication,
    applyReaderDefaults,
    applyEditionPreferences,
    showEditionConflict,
    resetReaderSearch,
  } = state;
  const { setContentsOpen, setReaderSearchOpen } = panels;

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!params.id) return;
      setLoading(true);
      setWork(undefined);
      setEPUBSource(undefined);
      setSource(null);
      epubSourceIDRef.current = '';
      audioSourceIDRef.current = '';
      pendingAudioHandoffRef.current = undefined;
      setAlignment(undefined);
      resetReaderPublication();
      setInitialAudioMS(undefined);
      const cachedPreferences = await cachedReaderPreferences().catch(() => null);
      if (cachedPreferences && !canceled) applyReaderDefaults(cachedPreferences);
      const stored = Platform.OS === 'web' ? null : await offlineWork(params.id);
      if (stored && !canceled) {
        const pending = await pendingProgress(params.id);
        const localProgress = pendingCanonicalProgress(stored.progress, pending);
        const storedEPUBID = stored.epubs.some((item) => item.id === params.epub)
          ? params.epub!
          : stored.epub_id;
        const storedAudioID = stored.audio.some((item) => item.id === params.audio)
          ? params.audio!
          : stored.audio_id;
        progressRef.current = localProgress;
        setWork(stored.work);
        setEPUBs(stored.epubs);
        setAudio(stored.audio);
        setJobs(stored.jobs);
        setProgress(localProgress);
        setEPUBID(storedEPUBID);
        setAudioID(storedAudioID);
        setSaveState(pending ? 'offline' : 'idle');
        setLoading(false);
      }
      try {
        const {
          nextWork,
          nextJobs,
          nextReaderDefaults,
          nextEPUBs,
          nextAudio,
          nextEPUB,
          nextAudioChoice,
          effectiveProgress,
        } = await loadConsumptionWork({ id: params.id, epub: params.epub, audio: params.audio });
        if (canceled) return;
        applyReaderDefaults(nextReaderDefaults);
        void cacheReaderPreferences(nextReaderDefaults).catch(() => {});
        progressRef.current = effectiveProgress;
        setWork(nextWork);
        setEPUBs(nextEPUBs);
        setAudio(nextAudio);
        setJobs(nextJobs);
        setProgress(effectiveProgress);
        setEPUBID(nextEPUB?.id ?? '');
        setAudioID(nextAudioChoice?.id ?? '');
      } catch (error) {
        if (!canceled && error instanceof APIError && error.status === 0) {
          if (stored) {
            setNotice('Offline mode · changes will sync when Aldus is reachable.');
          } else setNotice('This work is not downloaded for offline use.');
        } else if (!canceled) setNotice(errorMessage(error));
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [
    epubSourceIDRef,
    audioSourceIDRef,
    pendingAudioHandoffRef,
    setAlignment,
    setAudio,
    setAudioID,
    setEPUBID,
    setEPUBSource,
    setEPUBs,
    setInitialAudioMS,
    setJobs,
    setLoading,
    setNotice,
    setSource,
    setWork,
    applyReaderDefaults,
    params.id,
    params.epub,
    params.audio,
    resetReaderPublication,
    progressRef,
    setProgress,
    setSaveState,
  ]);

  useEffect(() => {
    let canceled = false;
    async function loadSelection() {
      const loadEPUB = Platform.OS === 'web' || shouldLoadConsumptionMedia(mode, 'epub');
      const loadAudio = shouldLoadConsumptionMedia(mode, 'audio');
      if (loadEPUB) {
        prepareReaderPublication(
          reusesReaderPublication(epubSourceIDRef.current, selectedEPUB?.id, epubSource),
        );
        setContentsOpen(false);
        setReaderSearchOpen(false);
        resetReaderSearch();
      }
      if (Platform.OS !== 'web' && !loadEPUB) {
        // Native unmounts the EPUB when switching to listening.
        releaseReaderPublication();
      }
      if (loadAudio) {
        restoredAudioRef.current = '';
      }
      setSyncAvailable(false);
      if (loadAudio) {
        setAudioReady(false);
        setAudioChapters([]);
      }
      setMediaLoading(true);
      let stored: Awaited<ReturnType<typeof offlineWork>> = null;
      try {
        const conflicts = await reconcileOfflineRepresentationStates(params.id);
        if (canceled) return;
        const selectedRepresentationID =
          mode === 'read' ? selectedEPUB?.representation.id : selectedAudio?.representation.id;
        const conflict = conflicts.find(
          (item) =>
            item.workID === params.id && item.local.representation_id === selectedRepresentationID,
        );
        editionConflictRef.current = conflict;
        setEditionConflict(conflict);
        if (conflict) showEditionConflict(conflict);
        stored = Platform.OS === 'web' || !params.id ? null : await offlineWork(params.id);
        if (stored && !canceled) {
          const selectedEPUBChoice = stored.epubs.find((item) => item.id === epubID);
          const selectedAudioChoice = stored.audio.find((item) => item.id === audioID);
          const canonical = progress?.alignment_id === stored.alignment?.id ? progress : null;
          setEPUBState(loadEPUB ? stored.epub_state : null);
          setAudioState(loadAudio ? stored.audio_state : null);
          if (loadAudio) setCurrentPlaybackRate(playbackRate(stored.audio_state?.playback_speed));
          setAudioChapters(loadAudio ? (stored.audio_chapters[audioID] ?? []) : []);
          setAlignment(stored.alignment);
          if (loadEPUB && selectedEPUBChoice) {
            setEPUBSource(
              await productEPUBSource(selectedEPUBChoice.id, selectedEPUBChoice.size_bytes),
            );
            epubSourceIDRef.current = selectedEPUBChoice.id;
          }
          if (loadAudio && selectedAudioChoice) {
            setSource(
              await productAudioSource(
                selectedAudioChoice.id,
                selectedAudioChoice.size_bytes,
                selectedAudioChoice.original_filename,
              ),
            );
            audioSourceIDRef.current = selectedAudioChoice.id;
          }
          if (loadEPUB) {
            applyEditionPreferences(stored.epub_state);
          }
          try {
            const targets = canonical
              ? canonicalResumeTargets(stored.alignment, canonical)
              : undefined;
            if (loadEPUB) {
              queueReaderRestore(targets ? targets.epub : stored.epub_state?.epub_locator);
            }
            if (loadAudio) {
              setInitialAudioMS(
                targets ? targets.audio.timestamp_ms : stored.audio_state?.audio_timestamp_ms,
              );
            }
            setSyncAvailable(Boolean(targets));
          } catch (error) {
            if (loadEPUB) {
              queueReaderRestore(undefined);
              setReaderRestoreError(true);
            }
            if (loadAudio) setSource(null);
            setNotice(errorMessage(error));
          }
        }
        const selectedJob = readyJob(jobs, epubID, audioID);
        const [nextEPUBState, nextAudioState, nextAlignment, blob, audioSource, nextAudioChapters] =
          await Promise.all([
            loadEPUB && selectedEPUB
              ? api.representationState(selectedEPUB.representation.id)
              : null,
            loadAudio && selectedAudio
              ? api.representationState(selectedAudio.representation.id)
              : null,
            selectedJob?.alignment_id
              ? alignment?.id === selectedJob.alignment_id
                ? alignment
                : api.alignment(selectedJob.alignment_id)
              : undefined,
            loadEPUB && selectedEPUB
              ? epubSourceIDRef.current === selectedEPUB.id && epubSource
                ? epubSource
                : productEPUBSource(selectedEPUB.id, selectedEPUB.size_bytes)
              : undefined,
            loadAudio && selectedAudio
              ? audioSourceIDRef.current === selectedAudio.id && source
                ? source
                : productAudioSource(
                    selectedAudio.id,
                    selectedAudio.size_bytes,
                    selectedAudio.original_filename,
                  )
              : null,
            loadAudio && selectedAudio ? api.audioChapters(selectedAudio.id).catch(() => []) : [],
          ]);
        if (canceled) return;
        if (loadEPUB) setEPUBState(nextEPUBState);
        if (loadAudio) {
          setAudioState(nextAudioState);
          setCurrentPlaybackRate(playbackRate(nextAudioState?.playback_speed));
          setAudioChapters(nextAudioChapters);
        }
        setAlignment(nextAlignment);
        if (loadEPUB) {
          setEPUBSource(blob);
          epubSourceIDRef.current = selectedEPUB?.id ?? '';
        }
        if (loadAudio) {
          setSource(audioSource);
          audioSourceIDRef.current = selectedAudio?.id ?? '';
        }
        if (loadEPUB) {
          applyEditionPreferences(nextEPUBState);
        }
        const canonical =
          progress?.resolvable && progress.alignment_id === selectedJob?.alignment_id
            ? progress
            : null;
        if (canonical && selectedJob?.alignment_id) {
          try {
            const targets = canonicalResumeTargets(nextAlignment, canonical);
            if (!canceled) {
              if (loadEPUB) queueReaderRestore(targets.epub);
              if (loadAudio) setInitialAudioMS(targets.audio.timestamp_ms);
              setSyncAvailable(true);
              setResumeMessage(
                resumedProgressLabel(
                  canonical.source_device,
                  loadAudio ? targets.audio.timestamp_ms / 1000 : undefined,
                ),
              );
            }
          } catch (error) {
            if (!canceled) {
              if (loadEPUB) {
                queueReaderRestore(undefined);
                setReaderRestoreError(true);
              }
              if (loadAudio) setSource(null);
              setNotice(errorMessage(error));
            }
          }
        } else {
          if (loadEPUB) queueReaderRestore(nextEPUBState?.epub_locator);
          if (loadAudio) setInitialAudioMS(nextAudioState?.audio_timestamp_ms);
        }
      } catch (error) {
        if (!canceled && error instanceof APIError && error.status === 0 && params.id) {
          if (!stored) return setNotice('This download is incomplete. Connect to Aldus and retry.');
          setNotice('Offline mode · changes will sync when Aldus is reachable.');
        } else if (!canceled) {
          if (__DEV__) console.error('Aldus could not load consumption media.', error);
          setNotice(
            error instanceof APIError
              ? errorMessage(error)
              : mode === 'read'
                ? 'Couldn\u2019t open this ebook. Go back and open it again.'
                : 'Couldn\u2019t open this audiobook. Go back and open it again.',
          );
        }
      } finally {
        if (!canceled) setMediaLoading(false);
      }
    }
    if (work) void loadSelection();
    return () => {
      canceled = true;
    };
    // Selection changes reload media; progress revision changes must not reload active playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    work,
    mode,
    epubID,
    audioID,
    jobs,
    progress?.alignment_id,
    progress?.resolvable,
    queueReaderRestore,
  ]);
}
