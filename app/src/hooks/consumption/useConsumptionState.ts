import { rememberReadingConflict } from '@/lib/consumption/reading-conflict';
import { useRepresentationProgress } from '@/hooks/consumption/useRepresentationProgress';
import { useAudioPlayback } from '@/hooks/consumption/useAudioPlayback';
import { useCanonicalProgress } from '@/hooks/consumption/useCanonicalProgress';
import { useReaderPreferences } from '@/hooks/consumption/useReaderPreferences';
import { useReaderRestoration } from '@/hooks/consumption/useReaderRestoration';
import { useReaderSearch } from '@/hooks/consumption/useReaderSearch';
import { useSleepTimer } from '@/hooks/consumption/useSleepTimer';
import { useReadingActivity } from '@/hooks/consumption/useReadingActivity';
import type { Alignment, AudioChapter, RepresentationState, Work } from '@/generated/api';
import type { AudioSource } from 'expo-audio';
import { useCallback, useRef, useState } from 'react';
import { audioPassage, readyJob, type MediaChoice } from '@/lib/consumption/consumption';
import { api } from '@/lib/api';
import { type RepresentationConflict } from '@/lib/offline-library';

type Mode = 'read' | 'listen';
export type ConsumptionParams = {
  id: string;
  mode?: 'read' | 'listen';
  epub?: string;
  audio?: string;
};
export type ConsumptionPanels = {
  setSettingsOpen: (open: boolean) => void;
  setContentsOpen: (open: boolean) => void;
  setReaderSearchOpen: (open: boolean) => void;
};

export function useConsumptionState(
  params: ConsumptionParams,
  onSave: (timestampMS: number, speed?: number) => Promise<boolean>,
) {
  const [work, setWork] = useState<Work>();
  const [mode, setMode] = useState<Mode>(params.mode === 'listen' ? 'listen' : 'read');
  const [epubs, setEPUBs] = useState<MediaChoice[]>([]);
  const [audio, setAudio] = useState<MediaChoice[]>([]);
  const [audioChapters, setAudioChapters] = useState<AudioChapter[]>([]);
  const [epubID, setEPUBID] = useState(params.epub ?? '');
  const [audioID, setAudioID] = useState(params.audio ?? '');
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.alignmentJobs>>>([]);
  const [alignment, setAlignment] = useState<Alignment>();
  const [epubState, setEPUBState] = useState<RepresentationState | null>(null);
  const [audioState, setAudioState] = useState<RepresentationState | null>(null);
  const [epubSource, setEPUBSource] = useState<string | Blob>();
  const [source, setSource] = useState<AudioSource>(null);
  const [initialAudioMS, setInitialAudioMS] = useState<number>();
  const [syncAvailable, setSyncAvailable] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [modeSwitching, setModeSwitching] = useState(false);
  const [editionConflict, setEditionConflict] = useState<RepresentationConflict>();
  const editionConflictRef = useRef<RepresentationConflict | undefined>(undefined);
  const [resolvingEditionConflict, setResolvingEditionConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(true);
  const epubSourceID = useRef('');
  const audioSourceID = useRef('');
  const restoredAudio = useRef('');
  const pendingAudioHandoff = useRef<{ audioID: string; timestampMS: number } | undefined>(
    undefined,
  );

  const lastAudioSave = useRef(-1);
  const representationSaves = useRef<Promise<void>>(Promise.resolve());
  const audioSaves = useRef<Promise<void>>(Promise.resolve());
  const representationSaveAttempt = useRef(0);
  const switching = useRef(false);
  const leaving = useRef(false);
  const exited = useRef(false);
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);
  const {
    player,
    status,
    audioDuration,
    chapter,
    currentPlaybackRate,
    setCurrentPlaybackRate,
    canAdjustPlaybackRate,
    seekToSeconds,
    handleSkipBack,
    handlePlayPause,
    handleSkipForward,
    handlePreviousChapter,
    handleNextChapter,
    handleScrubberSeek,
    cyclePlaybackRate,
    handlePlaybackRateAccessibilityAction,
  } = useAudioPlayback({
    source,
    work,
    selectedAudio,
    audioChapters,
    alignment,
    onSave,
    setNotice,
  });

  useReadingActivity(work, mode);

  const {
    sleepTimerOpen,
    setSleepTimerOpen,
    sleepTimerDeadline,
    sleepTimerRemaining,
    sleepTimerMinutes,
    setSleepTimer,
  } = useSleepTimer(player, status.currentTime, setNotice);

  const job = readyJob(jobs, epubID, audioID);
  const alignmentID = job?.alignment_id;
  const {
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
  } = useCanonicalProgress({
    workID: params.id,
    work,
    alignmentID,
    editionConflictRef,
    setSyncAvailable,
    setNotice,
  });

  const {
    readerLocation,
    readerTarget,
    readerCommit,
    readerContents,
    reader,
    readerInputBlocked,
    readerRestoreError,
    setReaderRestoreError,
    queueReaderRestore,
    resetReaderPublication,
    prepareReaderPublication,
    releaseReaderPublication,
    canRetryRestore,
    restoreReader,
    onReaderLocation,
    onReaderReady,
    readerInteractionReady,
  } = useReaderRestoration({ mode, mediaLoading, progress, alignmentID, setSyncAvailable });

  const {
    readerPreferences,
    readerDefaults,
    readerCustomized,
    settingsBusy,
    applyReaderDefaults,
    applyEditionPreferences,
    updateReaderPreferences,
    updateReaderCustomization,
  } = useReaderPreferences({
    representationID: selectedEPUB?.representation.id,
    epubState,
    setEPUBState,
    readerInteractionReady,
    setNotice,
  });

  const showEditionConflict = useCallback(
    (conflict: RepresentationConflict) => {
      editionConflictRef.current = conflict;
      setEditionConflict(conflict);
      void rememberReadingConflict(params.id, 'edition', conflict, readerScope).catch(() => {
        setNotice('Could not keep both places on this device. Leave this book open and try again.');
      });
      player.pause();
      setSaveState('error');
    },
    [params.id, readerScope, player, setSaveState, setNotice],
  );

  const { epubStateRef, audioStateRef, saveRepresentation } = useRepresentationProgress({
    work,
    selectedEPUB,
    selectedAudio,
    epubState,
    audioState,
    setEPUBState,
    setAudioState,
    readerLayout: readerPreferences.layout,
    defaultPlaybackSpeed: status.playbackRate,
    readerScope,
    isCurrentReader,
    editionConflictRef,
    progressConflictRef,
    showEditionConflict,
    setNotice,
  });

  const {
    query: readerSearchQuery,
    results: readerSearchResults,
    searching: readerSearching,
    ran: readerSearchRan,
    error: readerSearchError,
    search: runReaderSearch,
    changeQuery: changeReaderSearchQuery,
    reset: resetReaderSearch,
  } = useReaderSearch(reader);

  const canListenFromReader = Boolean(readerLocation?.sync);
  const passage = audioPassage(alignment?.segments, status.currentTime * 1000);
  const formatSwitchBusy =
    modeSwitching ||
    mediaLoading ||
    (mode === 'read'
      ? !readerInteractionReady
      : Boolean(
          source && !status.error && (!status.isLoaded || (initialAudioMS != null && !audioReady)),
        ));
  return {
    work,
    setWork,
    mode,
    setMode,
    epubs,
    setEPUBs,
    audio,
    setAudio,
    audioChapters,
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
    audioState,
    setAudioState,
    epubSource,
    setEPUBSource,
    source,
    setSource,
    initialAudioMS,
    setInitialAudioMS,
    syncAvailable,
    setSyncAvailable,
    audioReady,
    mediaLoadError,
    setMediaLoadError,
    setAudioReady,
    notice,
    setNotice,
    setModeSwitching,
    editionConflict,
    setEditionConflict,
    editionConflictRef,
    resolvingEditionConflict,
    setResolvingEditionConflict,
    loading,
    setLoading,
    mediaLoading,
    setMediaLoading,
    epubSourceID,
    audioSourceID,
    restoredAudio,
    pendingAudioHandoff,
    lastAudioSave,
    representationSaves,
    audioSaves,
    representationSaveAttempt,
    switching,
    leaving,
    exited,
    selectedEPUB,
    selectedAudio,
    player,
    status,
    audioDuration,
    chapter,
    currentPlaybackRate,
    setCurrentPlaybackRate,
    canAdjustPlaybackRate,
    seekToSeconds,
    handleSkipBack,
    handlePlayPause,
    handleSkipForward,
    handlePreviousChapter,
    handleNextChapter,
    handleScrubberSeek,
    cyclePlaybackRate,
    handlePlaybackRateAccessibilityAction,
    sleepTimerOpen,
    setSleepTimerOpen,
    sleepTimerDeadline,
    sleepTimerRemaining,
    sleepTimerMinutes,
    setSleepTimer,
    alignmentID,
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
    readerLocation,
    readerTarget,
    readerCommit,
    readerContents,
    reader,
    readerInputBlocked,
    readerRestoreError,
    setReaderRestoreError,
    queueReaderRestore,
    resetReaderPublication,
    prepareReaderPublication,
    releaseReaderPublication,
    canRetryRestore,
    restoreReader,
    onReaderLocation,
    onReaderReady,
    readerInteractionReady,
    readerPreferences,
    readerDefaults,
    readerCustomized,
    settingsBusy,
    applyReaderDefaults,
    applyEditionPreferences,
    updateReaderPreferences,
    updateReaderCustomization,
    showEditionConflict,
    epubStateRef,
    audioStateRef,
    saveRepresentation,
    readerSearchQuery,
    readerSearchResults,
    readerSearching,
    readerSearchRan,
    readerSearchError,
    runReaderSearch,
    changeReaderSearchQuery,
    resetReaderSearch,
    canListenFromReader,
    passage,
    formatSwitchBusy,
  };
}
export type ConsumptionState = ReturnType<typeof useConsumptionState>;
