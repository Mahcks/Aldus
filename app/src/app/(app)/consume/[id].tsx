import type {
  Alignment,
  AudioChapter,
  AudioLocator,
  CanonicalPosition,
  RepresentationState,
  Work,
} from '../../../generated/api';
import type { AudioSource } from 'expo-audio';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessibilityActionEvent, GestureResponderEvent } from 'react-native';
import { ActivityIndicator, AppState, Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_READER_PREFERENCES,
  EPUBReader,
  type EPUBReaderHandle,
  type ReaderLocation,
  type ReaderPreferences,
} from '../../../components/EPUBReader';
import { commitsReadingProgress } from '../../../components/reader-location';
import { BookCover, coverPresentation } from '../../../features/bookshelf';
import { ReaderSettings } from '../../../features/reader-settings';
import {
  applyPlaybackRate,
  audioChapterAt,
  audioPassage,
  choices,
  clampAudioPosition,
  defaultPair,
  formatAudioTime,
  listenToRead,
  playableAudioDuration,
  playbackRate,
  progressSaveLabel,
  progressSourceLabel,
  resumedProgressLabel,
  readToListen,
  readyJob,
  scrubberPosition,
  shouldLoadConsumptionMedia,
  sleepTimerDeadline as deadlineForSleepTimer,
  sleepTimerRemainingSeconds,
  SLEEP_TIMER_MINUTES,
  PLAYBACK_RATES,
  synchronizationLabel,
  type MediaChoice,
} from '../../../features/consumption';
import { fadeIn as passageEntrance } from '../../../features/motion';
import {
  Button,
  colors,
  Dialog,
  EmptyState,
  IconButton,
  Loading,
  Notice,
  StatusBadge,
} from '../../../features/ui';
import { Pressable, ScrollView, Text, View } from '../../../features/tw';
import { APIError, api, errorMessage } from '../../../lib/api';
import { productEPUBSource } from '../../../lib/epub-source';
import { goBackOr } from '../../../lib/navigation';
import { productAudioSource } from '../../../lib/media';
import { offlineWork, updateOfflineProgress } from '../../../lib/offline-library';
import {
  offlineAudioToCanonical,
  offlineCanonicalToAudio,
  offlineCanonicalToEPUB,
  offlineEPUBToCanonical,
} from '../../../features/offline-position';
import {
  pendingProgress,
  reconcilePendingProgress,
  saveWorkProgress,
} from '../../../lib/progress-outbox';

type Mode = 'read' | 'listen';
type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
type ProgressConflict = { local: CanonicalPosition; remote: CanonicalPosition };

export default function ConsumeWorkScreen() {
  const compact = useWindowDimensions().width < 600;
  const compactNative = compact && Platform.OS !== 'web';
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; mode?: Mode; epub?: string; audio?: string }>();
  const [work, setWork] = useState<Work>();
  const [mode, setMode] = useState<Mode>(params.mode === 'listen' ? 'listen' : 'read');
  const [epubs, setEPUBs] = useState<MediaChoice[]>([]);
  const [audio, setAudio] = useState<MediaChoice[]>([]);
  const [audioChapters, setAudioChapters] = useState<AudioChapter[]>([]);
  const [epubID, setEPUBID] = useState(params.epub ?? '');
  const [audioID, setAudioID] = useState(params.audio ?? '');
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.alignmentJobs>>>([]);
  const [alignment, setAlignment] = useState<Alignment>();
  const [progress, setProgress] = useState<CanonicalPosition | null>(null);
  const [epubState, setEPUBState] = useState<RepresentationState | null>(null);
  const [audioState, setAudioState] = useState<RepresentationState | null>(null);
  const [epubSource, setEPUBSource] = useState<string | Blob>();
  const [source, setSource] = useState<AudioSource>(null);
  const [readerLocation, setReaderLocation] = useState<ReaderLocation>();
  const [readerTarget, setReaderTarget] = useState<unknown>();
  const [readerCommit, setReaderCommit] = useState<ReaderLocation>();
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [sleepTimerDeadline, setSleepTimerDeadline] = useState<number>();
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number>();
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number>();
  const [initialAudioMS, setInitialAudioMS] = useState<number>();
  const [trackWidth, setTrackWidth] = useState(1);
  const [syncAvailable, setSyncAvailable] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAudioMS, setLastSavedAudioMS] = useState<number>();
  const [resumeMessage, setResumeMessage] = useState('');
  const [progressConflict, setProgressConflict] = useState<ProgressConflict>();
  const [loading, setLoading] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(true);
  const reader = useRef<EPUBReaderHandle>(null);
  const readerReady = useRef(false);
  const restoredReaderTarget = useRef<unknown>(undefined);
  const restoringReaderTarget = useRef<unknown>(undefined);
  const epubSourceID = useRef('');
  const audioSourceID = useRef('');
  const restoredAudio = useRef('');
  const playAfterRestore = useRef(false);
  const lastAudioSave = useRef(-1);
  const progressRef = useRef<CanonicalPosition | null>(null);
  const canonicalSaves = useRef<Promise<void>>(Promise.resolve());
  const switching = useRef(false);
  const saveAttempt = useRef(0);
  const sleepTimerExpired = useRef(false);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);
  const job = readyJob(jobs, epubID, audioID);
  const alignmentID = job?.alignment_id;
  const alignedDuration = Math.max(
    0,
    ...(alignment?.segments.map((segment) => segment.audio_end_ms / 1000) ?? []),
  );
  const audioDuration = playableAudioDuration(status.duration, alignedDuration);
  const audioProgress = audioDuration
    ? Math.max(0, Math.min(1, status.currentTime / audioDuration))
    : 0;
  const audioThumbLeft = Math.max(8, Math.min(trackWidth - 8, audioProgress * trackWidth));
  const canListenFromReader = Boolean(readerLocation?.sync);
  const passage = audioPassage(alignment?.segments, status.currentTime * 1000);
  const chapter = audioChapterAt(audioChapters, status.currentTime * 1000);
  const currentChapterTitle = chapter?.current.title;
  const currentPlaybackRate = playbackRate(status.playbackRate);
  const playbackRateIndex = PLAYBACK_RATES.indexOf(currentPlaybackRate);
  const canAdjustPlaybackRate = Boolean(source) && !status.error;
  const finishSleepTimer = useCallback(() => {
    if (sleepTimerExpired.current) return;
    sleepTimerExpired.current = true;
    player.pause();
    setSleepTimerDeadline(undefined);
    setSleepTimerRemaining(undefined);
    setSleepTimerMinutes(undefined);
    setSleepTimerOpen(false);
    setNotice('Sleep timer ended.');
  }, [player]);

  useEffect(() => {
    if (sleepTimerDeadline == null) return;

    function updateSleepTimer() {
      const remaining = sleepTimerRemainingSeconds(sleepTimerDeadline);
      setSleepTimerRemaining(remaining);
      if (remaining === 0) finishSleepTimer();
    }

    const timer = setInterval(updateSleepTimer, 1_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateSleepTimer();
    });
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [finishSleepTimer, sleepTimerDeadline]);

  useEffect(() => {
    if (sleepTimerDeadline == null || sleepTimerRemainingSeconds(sleepTimerDeadline) !== 0) return;
    const timer = setTimeout(finishSleepTimer, 0);
    return () => clearTimeout(timer);
  }, [finishSleepTimer, sleepTimerDeadline, status.currentTime]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => setNotice('Aldus could not configure background audio on this device.'));
  }, []);

  useEffect(() => {
    if (!work) return;
    let sessionID = '';
    let activeSeconds = 0;
    let stopped = false;
    void api
      .startActivity(work.id, { mode })
      .then((session) => {
        sessionID = session.id;
        if (stopped)
          void api.updateActivity(session.id, { active_seconds: activeSeconds, ended: true });
      })
      .catch(() => {});
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      activeSeconds += 15;
      if (sessionID)
        void api.updateActivity(sessionID, { active_seconds: activeSeconds, ended: false });
    }, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (sessionID)
        void api.updateActivity(sessionID, { active_seconds: activeSeconds, ended: true });
    };
  }, [work, mode]);

  useEffect(() => {
    if (Platform.OS === 'web' || !status.isLoaded || !work || !selectedAudio) return;
    try {
      player.setActiveForLockScreen(true, {
        title: work.title,
        artist: work.author || 'Unknown author',
        albumTitle: currentChapterTitle ?? selectedAudio.representation.label,
      });
    } catch {
      return;
    }
    return () => {
      try {
        player.setActiveForLockScreen(false);
      } catch {
        // The native player may already have been released while changing media.
      }
    };
  }, [currentChapterTitle, player, status.isLoaded, selectedAudio, work]);

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!params.id) return;
      setLoading(true);
      setWork(undefined);
      setEPUBSource(undefined);
      setSource(null);
      epubSourceID.current = '';
      audioSourceID.current = '';
      setAlignment(undefined);
      setReaderTarget(undefined);
      setReaderLocation(undefined);
      setReaderCommit(undefined);
      setInitialAudioMS(undefined);
      readerReady.current = false;
      restoredReaderTarget.current = undefined;
      restoringReaderTarget.current = undefined;
      const stored = Platform.OS === 'web' ? null : await offlineWork(params.id);
      if (stored && !canceled) {
        const pending = await pendingProgress(params.id);
        const localProgress = pending
          ? {
              ...stored.progress,
              alignment_id: pending.alignment_id,
              segment_id: pending.segment_id,
              offset: pending.offset,
            }
          : stored.progress;
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
        const [nextWork, representations, nextJobs, nextProgress, preference] = await Promise.all([
          api.work(params.id),
          api.representations(params.id),
          api.alignmentJobs(params.id),
          api.workProgress(params.id),
          api.workPreference(params.id),
        ]);
        const revisions = (
          await Promise.all(
            representations.map((representation) =>
              api.media(nextWork.library_id, representation.id),
            ),
          )
        ).flat();
        const nextEPUBs = choices(representations, revisions, ['epub']);
        const nextAudio = choices(representations, revisions, ['audio', 'audiobook']);
        const pair = defaultPair(
          nextJobs,
          nextEPUBs,
          nextAudio,
          preference?.alignment_id ?? nextProgress?.alignment_id,
        );
        const nextEPUB = nextEPUBs.find((item) => item.id === params.epub) ?? pair.epub;
        const nextAudioChoice = nextAudio.find((item) => item.id === params.audio) ?? pair.audio;
        const pending = Platform.OS === 'web' ? null : await pendingProgress(params.id);
        const effectiveProgress = pending
          ? {
              ...nextProgress,
              alignment_id: pending.alignment_id,
              segment_id: pending.segment_id,
              offset: pending.offset,
            }
          : nextProgress;
        if (canceled) return;
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
  }, [params.id, params.epub, params.audio]);

  useEffect(() => {
    let canceled = false;
    async function loadSelection() {
      const loadEPUB = Platform.OS === 'web' || shouldLoadConsumptionMedia(mode, 'epub');
      const loadAudio = shouldLoadConsumptionMedia(mode, 'audio');
      if (loadAudio) {
        restoredAudio.current = '';
        playAfterRestore.current = false;
      }
      setSyncAvailable(false);
      if (loadAudio) {
        setAudioReady(false);
        setAudioChapters([]);
      }
      setMediaLoading(true);
      let stored: Awaited<ReturnType<typeof offlineWork>> = null;
      try {
        stored = Platform.OS === 'web' || !params.id ? null : await offlineWork(params.id);
        if (stored && !canceled) {
          const selectedEPUBChoice = stored.epubs.find((item) => item.id === epubID);
          const selectedAudioChoice = stored.audio.find((item) => item.id === audioID);
          const canonical = progress?.alignment_id === stored.alignment?.id ? progress : null;
          setEPUBState(loadEPUB ? stored.epub_state : null);
          setAudioState(loadAudio ? stored.audio_state : null);
          setAudioChapters(loadAudio ? (stored.audio_chapters[audioID] ?? []) : []);
          setAlignment(stored.alignment);
          if (loadEPUB && selectedEPUBChoice) {
            setEPUBSource(
              await productEPUBSource(selectedEPUBChoice.id, selectedEPUBChoice.size_bytes),
            );
            epubSourceID.current = selectedEPUBChoice.id;
          }
          if (loadAudio && selectedAudioChoice) {
            setSource(
              await productAudioSource(selectedAudioChoice.id, selectedAudioChoice.size_bytes),
            );
            audioSourceID.current = selectedAudioChoice.id;
          }
          if (loadEPUB) setReaderPreferences(preferencesFromState(stored.epub_state));
          const storedEPUBTarget =
            canonical && stored.alignment
              ? offlineCanonicalToEPUB(stored.alignment, canonical)
              : stored.epub_state?.epub_locator;
          const storedAudioTarget =
            canonical && stored.alignment
              ? offlineCanonicalToAudio(stored.alignment, canonical)?.timestamp_ms
              : stored.audio_state?.audio_timestamp_ms;
          setReaderTarget(loadEPUB ? storedEPUBTarget : undefined);
          setInitialAudioMS(loadAudio ? storedAudioTarget : undefined);
          setSyncAvailable(Boolean(canonical && stored.alignment));
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
              ? epubSourceID.current === selectedEPUB.id && epubSource
                ? epubSource
                : productEPUBSource(selectedEPUB.id, selectedEPUB.size_bytes)
              : undefined,
            loadAudio && selectedAudio
              ? audioSourceID.current === selectedAudio.id && source
                ? source
                : productAudioSource(selectedAudio.id, selectedAudio.size_bytes)
              : null,
            loadAudio && selectedAudio ? api.audioChapters(selectedAudio.id).catch(() => []) : [],
          ]);
        if (canceled) return;
        if (loadEPUB) setEPUBState(nextEPUBState);
        if (loadAudio) {
          setAudioState(nextAudioState);
          setAudioChapters(nextAudioChapters);
        }
        setAlignment(nextAlignment);
        if (loadEPUB) {
          setEPUBSource(blob);
          epubSourceID.current = selectedEPUB?.id ?? '';
        }
        if (loadAudio) {
          setSource(audioSource);
          audioSourceID.current = selectedAudio?.id ?? '';
        }
        if (loadEPUB) setReaderPreferences(preferencesFromState(nextEPUBState));
        const canonical =
          progress?.resolvable && progress.alignment_id === selectedJob?.alignment_id
            ? progress
            : null;
        if (canonical && selectedJob?.alignment_id) {
          try {
            let resumedAudioMS: number | undefined;
            if (loadEPUB) {
              const epubTarget = await api.canonicalToEPUB(selectedJob.alignment_id, canonical);
              if (!canceled) setReaderTarget(epubTarget);
            } else {
              const audioTarget = await api.canonicalToAudio(selectedJob.alignment_id, canonical);
              resumedAudioMS = audioTarget.timestamp_ms;
              if (!canceled) setInitialAudioMS(audioTarget.timestamp_ms);
            }
            if (!canceled) {
              setSyncAvailable(true);
              setResumeMessage(
                resumedProgressLabel(
                  canonical.source_device,
                  resumedAudioMS == null ? undefined : resumedAudioMS / 1000,
                ),
              );
            }
          } catch {
            if (!canceled) {
              if (loadEPUB) setReaderTarget(nextEPUBState?.epub_locator);
              if (loadAudio) setInitialAudioMS(nextAudioState?.audio_timestamp_ms);
            }
          }
        } else {
          if (loadEPUB) setReaderTarget(nextEPUBState?.epub_locator);
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
  }, [work, mode, epubID, audioID, jobs, progress?.alignment_id, progress?.resolvable]);

  const restoreReader = useCallback(
    async (target: unknown) => {
      if (
        !readerReady.current ||
        !target ||
        restoredReaderTarget.current === target ||
        restoringReaderTarget.current === target
      )
        return;
      restoringReaderTarget.current = target;
      let restored = false;
      try {
        for (let attempt = 0; attempt < 3 && readerReady.current; attempt += 1) {
          restored = Boolean(
            await reader.current?.restoreLocation(
              target,
              Boolean(progress?.resolvable && progress.alignment_id === alignmentID),
            ),
          );
          if (restored) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        if (__DEV__) console.error('Aldus could not restore the EPUB position.', error);
      }
      if (restoringReaderTarget.current !== target) return;
      restoringReaderTarget.current = undefined;
      if (restored) restoredReaderTarget.current = target;
      else
        setNotice('Couldn\u2019t restore your saved page. You can keep reading and retry later.');
    },
    [progress?.resolvable, progress?.alignment_id, alignmentID],
  );

  useEffect(() => {
    if (!readerReady.current || !readerTarget || restoredReaderTarget.current === readerTarget)
      return;
    void restoreReader(readerTarget);
  }, [readerTarget, restoreReader]);

  useEffect(() => {
    if (!work) return;
    const workID = work.id;
    let active = true;
    let refreshing = false;
    async function refreshProgress() {
      if (refreshing || switching.current) return;
      refreshing = true;
      const pending = canonicalSaves.current;
      try {
        await pending;
        const queued = await reconcilePendingProgress(workID);
        if (queued) {
          setProgressConflict({
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
          canonicalSaves.current !== pending ||
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
          if (!active) return;
          setReaderTarget(target);
        } else {
          const target = await api.canonicalToAudio(alignmentID, next);
          if (!active) return;
          restoredAudio.current = '';
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
  }, [work, alignmentID, mode]);

  useEffect(() => {
    if (mode !== 'listen') return;
    if (!status.isLoaded) return;
    if (initialAudioMS == null) return;
    if (audioDuration <= 0) return;
    if (restoredAudio.current === `${audioID}:${initialAudioMS}`) return;
    void (async () => {
      try {
        await player.seekTo(clampAudioPosition(initialAudioMS / 1000, audioDuration), 0, 0);
        applyPlaybackRate(player, audioState?.playback_speed);
        restoredAudio.current = `${audioID}:${initialAudioMS}`;
        setAudioReady(true);
        if (!playAfterRestore.current) return;
        playAfterRestore.current = false;
        player.play();
      } catch (error) {
        playAfterRestore.current = false;
        setAudioReady(false);
        setNotice(errorMessage(error));
      }
    })();
  }, [
    mode,
    status.isLoaded,
    audioDuration,
    initialAudioMS,
    audioID,
    audioState?.playback_speed,
    player,
  ]);

  const onReaderLocation = useCallback((location: ReaderLocation) => {
    setReaderLocation(location);
    if (commitsReadingProgress(location.reason)) setReaderCommit(location);
    setSyncAvailable(Boolean(location.sync));
  }, []);
  const onReaderReady = useCallback(() => {
    readerReady.current = true;
    if (readerTarget && restoredReaderTarget.current !== readerTarget) {
      void restoreReader(readerTarget);
    }
  }, [readerTarget, restoreReader]);

  useEffect(() => {
    if (mode !== 'read' || !readerLocation || !selectedEPUB) return;
    const location = readerLocation;
    let saved = false;
    function save() {
      if (saved) return;
      saved = true;
      void saveRepresentation('epub', { href: location.href, cfi: location.cfi });
    }
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
      !status.isLoaded ||
      (initialAudioMS != null && !audioReady) ||
      !selectedAudio
    )
      return;
    const timestamp = Math.round(status.currentTime * 1000);
    if (lastAudioSave.current >= 0 && Math.abs(timestamp - lastAudioSave.current) < 2000) return;
    lastAudioSave.current = timestamp;
    void saveListeningPosition(timestamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status.currentTime, status.isLoaded, audioReady, selectedAudio?.id, alignmentID]);

  async function saveRepresentation(
    kind: 'epub' | 'audio',
    value: unknown,
    playbackSpeed = status.playbackRate || 1,
  ) {
    const selected = kind === 'epub' ? selectedEPUB : selectedAudio;
    const state = kind === 'epub' ? epubState : audioState;
    if (!selected) return;
    try {
      const next = await api.updateRepresentationState(
        selected.representation.id,
        kind === 'epub'
          ? {
              epub_locator: value,
              reader_layout: readerPreferences.layout,
              expected_revision: state?.revision ?? 0,
            }
          : {
              audio_timestamp_ms: value as number,
              playback_speed: playbackSpeed,
              expected_revision: state?.revision ?? 0,
            },
      );
      if (kind === 'epub') setEPUBState(next);
      else setAudioState(next);
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        const current = await api.representationState(selected.representation.id);
        if (kind === 'epub') setEPUBState(current);
        else setAudioState(current);
      } else if (!(error instanceof APIError && error.status === 0)) setNotice(errorMessage(error));
    }
  }

  async function saveCanonical(canonical: CanonicalPosition) {
    if (!work || !alignmentID) return false;
    const attempt = ++saveAttempt.current;
    setSaveState('saving');
    let saved = false;
    canonicalSaves.current = canonicalSaves.current
      .catch(() => {})
      .then(async () => {
        try {
          const current = progressRef.current;
          if (
            current?.alignment_id === alignmentID &&
            current.segment_id === canonical.segment_id &&
            current.offset === canonical.offset
          ) {
            saved = true;
            if (attempt === saveAttempt.current) setSaveState('saved');
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
            const result = await saveWorkProgress(work.id, update);
            if (!result) {
              const local = {
                ...progressRef.current,
                ...canonical,
                alignment_id: alignmentID,
              };
              progressRef.current = local;
              setProgress(local);
              await updateOfflineProgress(work.id, local);
              if (attempt === saveAttempt.current) setSaveState('offline');
              return;
            }
            next = result;
          } catch (error) {
            if (!(error instanceof APIError && error.status === 409)) throw error;
            const latest = await api.workProgress(work.id);
            if (!latest) throw error;
            progressRef.current = latest;
            setProgress(latest);
            setProgressConflict({ local: canonical, remote: latest });
            if (attempt === saveAttempt.current) setSaveState('error');
            return;
          }
          progressRef.current = next;
          await updateOfflineProgress(work.id, next);
          setProgress(next);
          setSyncAvailable(true);
          setResumeMessage('');
          saved = true;
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

  async function restoreCanonical(next: CanonicalPosition) {
    if (!alignmentID || !next.resolvable || next.alignment_id !== alignmentID) return;
    if (mode === 'read') setReaderTarget(await api.canonicalToEPUB(alignmentID, next));
    else {
      const target = await api.canonicalToAudio(alignmentID, next);
      restoredAudio.current = '';
      setAudioReady(false);
      setInitialAudioMS(target.timestamp_ms);
    }
  }

  async function acceptRemoteProgress() {
    if (!progressConflict) return;
    const remote = progressConflict.remote;
    setProgressConflict(undefined);
    setSaveState('saved');
    await restoreCanonical(remote);
    setResumeMessage(resumedProgressLabel(remote.source_device));
  }

  async function keepLocalProgress() {
    if (!progressConflict) return;
    const local = progressConflict.local;
    setProgressConflict(undefined);
    await saveCanonical(local);
  }

  async function updateReaderPreferences(next: ReaderPreferences) {
    if (!selectedEPUB || settingsBusy) return;
    setSettingsBusy(true);
    try {
      const state = await api.updateRepresentationState(selectedEPUB.representation.id, {
        reader_layout: next.layout,
        zoom: next.zoom,
        reader_theme: next.theme,
        line_height: next.lineHeight,
        margin: next.margin,
        expected_revision: epubState?.revision ?? 0,
      });
      setEPUBState(state);
      setReaderPreferences(next);
      setNotice('');
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        const current = await api.representationState(selectedEPUB.representation.id);
        setEPUBState(current);
        setReaderPreferences(preferencesFromState(current));
        setNotice('Reader settings changed on another device. Reloaded the newer settings.');
      } else setNotice(errorMessage(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function saveReadingCursor(location: ReaderLocation) {
    if (
      switching.current ||
      !alignmentID ||
      !location.sync ||
      !commitsReadingProgress(location.reason)
    )
      return;
    try {
      await saveCanonical(await api.epubToCanonical(alignmentID, location.sync));
    } catch (error) {
      if (error instanceof APIError && error.status === 0) {
        const canonical = offlineEPUBToCanonical(alignmentID, location.sync);
        if (canonical) await saveCanonical(canonical);
      } else if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
      else setNotice(errorMessage(error));
    }
  }

  async function saveListeningPosition(timestampMS: number) {
    await saveRepresentation('audio', timestampMS);
    if (switching.current || !alignmentID || !alignment?.segments[0]) return;
    const locator: AudioLocator = {
      resource: alignment.segments[0].audio_resource,
      timestamp_ms: timestampMS,
    };
    try {
      if (await saveCanonical(await api.audioToCanonical(alignmentID, locator)))
        setLastSavedAudioMS(timestampMS);
    } catch (error) {
      if (error instanceof APIError && error.status === 0 && alignment) {
        const canonical = offlineAudioToCanonical(alignment, locator);
        if (canonical && (await saveCanonical(canonical))) setLastSavedAudioMS(timestampMS);
      } else if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
      else setNotice(errorMessage(error));
    }
  }

  async function switchToListen() {
    if (!work || !readerLocation?.sync || !alignmentID)
      return setNotice('Synchronized listening is unavailable at this passage.');
    switching.current = true;
    try {
      await canonicalSaves.current;
      const { progress: next, target } = await readToListen(
        api,
        work.id,
        alignmentID,
        readerLocation.sync,
        progressRef.current?.revision ?? 0,
        Platform.OS,
      );
      if (__DEV__)
        console.debug('Aldus Read → Listen', {
          href: readerLocation.sync.href,
          locator: readerLocation.sync.locator,
          canonical: { segment_id: next.segment_id, offset: next.offset },
          audio_timestamp_ms: target.timestamp_ms,
        });
      progressRef.current = next;
      setProgress(next);
      setAudioReady(false);
      playAfterRestore.current = true;
      restoredAudio.current = '';
      setInitialAudioMS(target.timestamp_ms);
      setMode('listen');
      setNotice('');
    } catch (error) {
      playAfterRestore.current = false;
      if (error instanceof APIError && error.status === 0 && alignment) {
        const canonical = offlineEPUBToCanonical(alignmentID, readerLocation.sync);
        const target = canonical && offlineCanonicalToAudio(alignment, canonical);
        if (canonical && target) {
          await saveCanonical(canonical);
          setAudioReady(false);
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
            ? 'Synchronized listening is unavailable at this passage.'
            : errorMessage(error),
        );
      }
    } finally {
      switching.current = false;
    }
  }

  async function switchToRead() {
    if (!work || !alignmentID || !alignment?.segments[0])
      return setNotice('Synchronized reading is unavailable at this point.');
    switching.current = true;
    try {
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
      setReaderTarget(target);
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
          setReaderTarget(target);
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
    }
  }

  function seekToSeconds(targetSeconds: number) {
    if (!Number.isFinite(targetSeconds) || audioDuration <= 0) return;
    void player.seekTo(clampAudioPosition(targetSeconds, audioDuration));
  }
  function handleSkipBack() {
    seekToSeconds(status.currentTime - 15);
  }
  function handlePlayPause() {
    if (status.playing) {
      player.pause();
      void saveListeningPosition(Math.round(player.currentTime * 1000));
    } else {
      player.play();
    }
  }
  function handleSkipForward() {
    seekToSeconds(status.currentTime + 15);
  }
  function handlePreviousChapter() {
    if (chapter?.previous) seekToSeconds(chapter.previous.start_ms / 1000);
  }
  function handleNextChapter() {
    if (chapter?.next) seekToSeconds(chapter.next.start_ms / 1000);
  }
  function selectChapter(next: AudioChapter) {
    seekToSeconds(next.start_ms / 1000);
    setChaptersOpen(false);
  }
  function setSleepTimer(minutes?: number) {
    sleepTimerExpired.current = false;
    setSleepTimerDeadline(deadlineForSleepTimer(minutes));
    setSleepTimerRemaining(minutes == null ? undefined : minutes * 60);
    setSleepTimerMinutes(minutes);
    setSleepTimerOpen(false);
  }
  function handleScrubberPress(event: GestureResponderEvent) {
    const nativeEvent = event.nativeEvent as GestureResponderEvent['nativeEvent'] & {
      offsetX?: number;
    };
    const x = Number.isFinite(nativeEvent.locationX)
      ? nativeEvent.locationX
      : (nativeEvent.offsetX ?? NaN);
    const target = scrubberPosition(x, trackWidth, audioDuration);
    if (target != null) seekToSeconds(target);
  }
  function handleScrubberAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === 'increment') seekToSeconds(status.currentTime + 5);
    else if (event.nativeEvent.actionName === 'decrement') seekToSeconds(status.currentTime - 5);
  }
  function handleScrubberKeyDown(event: { key: string; preventDefault?: () => void }) {
    if (event.key === 'ArrowRight') {
      event.preventDefault?.();
      seekToSeconds(status.currentTime + 5);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault?.();
      seekToSeconds(status.currentTime - 5);
    }
  }
  function handlePlaybackRate(rate: number) {
    if (!canAdjustPlaybackRate) return;
    try {
      const next = applyPlaybackRate(player, rate);
      void saveRepresentation('audio', Math.round(status.currentTime * 1000), next);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }
  function stepPlaybackRate(direction: -1 | 1) {
    const nextIndex = Math.max(
      0,
      Math.min(PLAYBACK_RATES.length - 1, playbackRateIndex + direction),
    );
    handlePlaybackRate(PLAYBACK_RATES[nextIndex]);
  }
  function cyclePlaybackRate() {
    handlePlaybackRate(PLAYBACK_RATES[(playbackRateIndex + 1) % PLAYBACK_RATES.length]);
  }
  function handlePlaybackRateAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === 'increment') stepPlaybackRate(1);
    else if (event.nativeEvent.actionName === 'decrement') stepPlaybackRate(-1);
  }
  function handleReadMode() {
    if (mode === 'listen' && alignmentID && status.isLoaded) void switchToRead();
    else setMode('read');
  }
  function handleListenMode() {
    if (mode === 'read' && readerLocation?.sync && alignmentID) void switchToListen();
    else setMode('listen');
  }
  const scrubberKeyboardProps = Platform.OS === 'web' ? { onKeyDown: handleScrubberKeyDown } : {};

  if (loading || !work)
    return loading ? (
      <Loading label="Opening your book…" />
    ) : (
      <View className="min-h-full flex-1 items-center justify-center bg-canvas p-6">
        <Notice danger>{notice || 'Work unavailable.'}</Notice>
      </View>
    );
  const syncLabel = synchronizationLabel(jobs, epubID, audioID);
  const pageSyncLabel =
    readerLocation?.syncState === 'full'
      ? 'Synchronized here'
      : readerLocation?.syncState === 'partial'
        ? 'Partially synchronized'
        : 'Synchronization unavailable here';
  const compactPageSyncLabel =
    readerLocation?.syncState === 'full'
      ? 'Synchronized'
      : readerLocation?.syncState === 'partial'
        ? 'Partially synchronized'
        : 'Synchronization unavailable';
  const readerHelper = canListenFromReader
    ? 'Continue with the narration at the marked passage.'
    : readerLocation?.syncState === 'partial'
      ? 'Move to synchronized text to continue listening.'
      : 'Synchronization is unavailable in this section.';
  const saveLabel = progressSaveLabel(saveState, mode, lastSavedAudioMS);
  const progressStatus = resumeMessage || saveLabel;
  return (
    <View className="flex-1 bg-canvas">
      <View
        className={`flex-row items-center gap-2 border-b border-line bg-paper ${
          compactNative ? 'min-h-11' : 'min-h-[62px] px-3 pb-2'
        }`}
        style={{
          paddingTop: compactNative ? insets.top : insets.top + 8,
          paddingLeft: compactNative ? insets.left + 12 : undefined,
          paddingRight: compactNative ? insets.right + 12 : undefined,
        }}
      >
        <IconButton
          icon="back"
          label="Back to work"
          kind="quiet"
          onPress={() => goBackOr(`/work/${params.id}`)}
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-base font-sans-bold text-ink">
            {work.title}
          </Text>
          {!compact ? (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
              {work.author || 'Unknown author'}
            </Text>
          ) : null}
        </View>
        <View className="flex-row gap-2">
          {mode === 'read' && selectedEPUB ? (
            <IconButton
              icon="settings"
              label={settingsOpen ? 'Close reader settings' : 'Open reader settings'}
              kind="quiet"
              selected={settingsOpen}
              onPress={() => setSettingsOpen((open) => !open)}
            />
          ) : null}
          {selectedEPUB && (!compactNative || mode === 'listen') ? (
            compact ? (
              <IconButton
                label="Read"
                icon="read"
                kind={mode === 'read' ? 'primary' : 'secondary'}
                selected={mode === 'read'}
                onPress={handleReadMode}
              />
            ) : (
              <Button
                label="Read"
                icon="read"
                kind={mode === 'read' ? 'primary' : 'secondary'}
                onPress={handleReadMode}
              />
            )
          ) : null}
          {selectedAudio && (!compactNative || mode === 'read') ? (
            compact ? (
              <IconButton
                label="Listen"
                icon="listen"
                kind={mode === 'listen' ? 'primary' : 'secondary'}
                selected={mode === 'listen'}
                onPress={handleListenMode}
              />
            ) : (
              <Button
                label="Listen"
                icon="listen"
                kind={mode === 'listen' ? 'primary' : 'secondary'}
                onPress={handleListenMode}
              />
            )
          ) : null}
        </View>
      </View>
      {!compactNative ? (
        <View className="min-h-[30px] items-center justify-center border-b border-line bg-panel">
          <Text accessibilityLiveRegion="polite" className="text-xs font-sans-semibold text-muted">
            {progressStatus ||
              (mode === 'read' && alignmentID
                ? pageSyncLabel
                : syncAvailable
                  ? 'Synchronized here'
                  : syncLabel)}
          </Text>
        </View>
      ) : null}
      {notice ? (
        <View className="px-5 pt-3">
          <Notice danger>{notice}</Notice>
        </View>
      ) : null}
      {progressConflict ? (
        <View className="gap-3 border-b border-warning/30 bg-panel px-5 py-3">
          <Notice tone="warning">
            Your place changed on {progressSourceLabel(progressConflict.remote.source_device)}.
            Choose which position Aldus should keep.
          </Notice>
          <View className="flex-row flex-wrap gap-2">
            <Button label="Use newer saved place" onPress={() => void acceptRemoteProgress()} />
            <Button
              label="Keep this place"
              kind="secondary"
              onPress={() => void keepLocalProgress()}
            />
          </View>
        </View>
      ) : null}
      {mode === 'read' && settingsOpen && !compactNative ? (
        <Animated.View entering={passageEntrance}>
          <ReaderSettings
            value={readerPreferences}
            disabled={settingsBusy}
            onChange={(next) => void updateReaderPreferences(next)}
          />
        </Animated.View>
      ) : null}
      <Dialog
        visible={compactNative && mode === 'read' && settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Reading settings"
      >
        <ReaderSettings
          compact
          value={readerPreferences}
          disabled={settingsBusy}
          onChange={(next) => void updateReaderPreferences(next)}
        />
      </Dialog>
      <Dialog
        visible={mode === 'listen' && chaptersOpen}
        onClose={() => setChaptersOpen(false)}
        title="Chapters"
      >
        <View className="gap-2">
          {audioChapters.map((item, index) => (
            <Button
              key={`${item.start_ms}-${item.title}`}
              label={`${index + 1}. ${item.title} · ${formatAudioTime((item.end_ms - item.start_ms) / 1000)}`}
              kind="quiet"
              selected={chapter?.index === index}
              accessibilityRole="button"
              onPress={() => selectChapter(item)}
            />
          ))}
        </View>
      </Dialog>
      <Dialog
        visible={mode === 'listen' && sleepTimerOpen}
        onClose={() => setSleepTimerOpen(false)}
        title="Sleep timer"
      >
        <View accessibilityRole="radiogroup" className="gap-2">
          <Button
            label="Off"
            selected={sleepTimerDeadline == null}
            accessibilityRole="radio"
            onPress={() => setSleepTimer()}
          />
          {SLEEP_TIMER_MINUTES.map((minutes) => (
            <Button
              key={minutes}
              label={`${minutes} minutes`}
              selected={sleepTimerMinutes === minutes}
              accessibilityRole="radio"
              onPress={() => setSleepTimer(minutes)}
            />
          ))}
        </View>
      </Dialog>
      {/* Foliate has queued iframe work during handoff, so keep only the web reader mounted. */}
      <View className={mode === 'read' ? 'min-h-0 flex-1' : 'hidden'}>
        {(Platform.OS === 'web' || mode === 'read') && selectedEPUB && epubSource ? (
          <View
            className={
              compactNative
                ? 'min-h-0 w-full flex-1'
                : 'min-h-0 w-full max-w-[1100px] flex-1 self-center px-4 pt-2.5'
            }
          >
            <EPUBReader
              ref={reader}
              source={epubSource}
              product
              segments={alignment?.segments}
              preferences={readerPreferences}
              compactChrome={compactNative}
              statusLabel={
                compactNative
                  ? progressStatus ||
                    (alignmentID
                      ? compactPageSyncLabel
                      : syncAvailable
                        ? 'Synchronized'
                        : syncLabel)
                  : undefined
              }
              onLocation={onReaderLocation}
              onReady={onReaderReady}
              onError={(error) => setNotice(error.message || 'Unable to open EPUB.')}
            />
            {!compactNative ? (
              <SafeAreaView edges={['bottom']}>
                <View className="min-h-[62px] w-full shrink-0 flex-row items-center justify-between gap-3 border-t border-line py-2.5">
                  <Text className="flex-1 text-[13px] leading-[19px] text-muted">
                    {readerHelper}
                  </Text>
                  <Button
                    label={canListenFromReader ? 'Listen from here' : 'Listen unavailable here'}
                    icon="listen"
                    disabled={!canListenFromReader}
                    onPress={() => void switchToListen()}
                  />
                </View>
              </SafeAreaView>
            ) : null}
          </View>
        ) : (
          <View className="flex-1 items-center justify-center p-8">
            {mediaLoading ? (
              <View accessibilityLiveRegion="polite" className="items-center gap-3">
                <ActivityIndicator color={colors.accent} />
                <Text className="text-sm text-muted">Preparing ebook…</Text>
              </View>
            ) : (
              <EmptyState
                icon="read"
                title={selectedEPUB ? 'Couldn’t open this ebook' : 'No EPUB available'}
              >
                {selectedEPUB
                  ? 'Try opening it again.'
                  : 'This Work doesn’t have a readable edition yet.'}
              </EmptyState>
            )}
          </View>
        )}
      </View>
      {mode === 'listen' ? (
        selectedAudio ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName="w-full flex-grow pt-6"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          >
            <View className="mx-auto w-full max-w-[560px] px-6">
              <View className="items-center gap-4 pt-2">
                <BookCover
                  title={work.title}
                  author={work.author}
                  coverURL={work.cover_url}
                  size="hero"
                  {...coverPresentation(work)}
                />
                <View className="items-center gap-1.5 px-4">
                  <Text
                    numberOfLines={2}
                    className="text-center font-editorial-bold text-[26px] leading-8 text-ink"
                  >
                    {work.title}
                  </Text>
                  <Text numberOfLines={1} className="text-center text-sm text-text-secondary">
                    {work.author || 'Unknown author'}
                  </Text>
                  <Text
                    numberOfLines={2}
                    className="mt-1 text-center text-[11px] font-sans-semibold uppercase tracking-[1.5px] text-subtle"
                  >
                    {selectedAudio.representation.label}
                  </Text>
                  {progressStatus ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      className="text-xs font-sans-semibold text-muted"
                    >
                      {progressStatus}
                    </Text>
                  ) : null}
                </View>
              </View>
              {status.error ? (
                <View className="mt-5">
                  <Notice danger>The audiobook could not be opened on this device.</Notice>
                </View>
              ) : !status.isLoaded ? (
                <View accessibilityLiveRegion="polite" className="mt-5 items-center gap-2">
                  <ActivityIndicator color={colors.accent} />
                  <Text className="text-sm text-muted">Loading audiobook…</Text>
                </View>
              ) : null}
              <View className="mt-9 w-full gap-2">
                <Pressable
                  accessibilityRole="adjustable"
                  accessibilityLabel="Audiobook position"
                  accessibilityValue={{
                    min: 0,
                    max: Math.round(audioDuration),
                    now: Math.round(status.currentTime),
                    text: `${formatAudioTime(status.currentTime)} of ${formatAudioTime(audioDuration)}`,
                  }}
                  accessibilityActions={[
                    { name: 'increment', label: 'Skip ahead 5 seconds' },
                    { name: 'decrement', label: 'Skip back 5 seconds' },
                  ]}
                  accessibilityState={{ disabled: !status.isLoaded }}
                  disabled={!status.isLoaded}
                  focusable
                  onAccessibilityAction={handleScrubberAccessibilityAction}
                  className={`h-11 w-full justify-center rounded-control focus-visible:border focus-visible:border-focus ${status.isLoaded ? '' : 'opacity-50'}`}
                  onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
                  onPress={handleScrubberPress}
                  {...scrubberKeyboardProps}
                >
                  <View className="absolute left-0 right-0 h-1.5 rounded-pill bg-panel-strong" />
                  <View
                    className="absolute left-0 h-1.5 rounded-pill bg-accent"
                    style={{
                      width: `${audioProgress * 100}%`,
                    }}
                  />
                  {status.isLoaded && audioDuration ? (
                    <View
                      className="absolute h-4 w-4 rounded-pill bg-accent shadow-xs"
                      style={{
                        left: audioThumbLeft,
                        transform: [{ translateX: -8 }],
                      }}
                    />
                  ) : null}
                </Pressable>
                <View className="flex-row justify-between">
                  <Text
                    className="text-[13px] font-sans-semibold text-ink"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatAudioTime(status.currentTime)}
                  </Text>
                  <Text
                    className="text-[13px] text-subtle"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatAudioTime(audioDuration)}
                  </Text>
                </View>
              </View>
              {chapter ? (
                <View className="mt-5 w-full flex-row items-center gap-3 border-y border-line-subtle py-2">
                  <IconButton
                    icon="previousPage"
                    label="Previous chapter"
                    kind="quiet"
                    disabled={!chapter.previous}
                    onPress={handlePreviousChapter}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View chapters. Current chapter: ${chapter.current.title}`}
                    onPress={() => setChaptersOpen(true)}
                    className="min-h-11 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-control px-2 focus-visible:border focus-visible:border-focus"
                  >
                    <Text numberOfLines={1} className="text-center text-sm font-sans-bold text-ink">
                      {chapter.current.title}
                    </Text>
                    <Text className="text-center text-[11px] font-sans-semibold uppercase tracking-[1px] text-subtle">
                      Chapter {chapter.index + 1} of {audioChapters.length} · View all
                    </Text>
                  </Pressable>
                  <IconButton
                    icon="nextPage"
                    label="Next chapter"
                    kind="quiet"
                    disabled={!chapter.next}
                    onPress={handleNextChapter}
                  />
                </View>
              ) : null}
              <View className="mt-8 w-full flex-row items-center justify-between">
                <View className="w-16 items-start">
                  <Pressable
                    accessibilityRole="adjustable"
                    accessibilityLabel="Playback speed"
                    accessibilityHint="Cycles through playback speeds"
                    accessibilityValue={{ text: `${currentPlaybackRate} times` }}
                    accessibilityActions={[
                      { name: 'increment', label: 'Increase playback speed' },
                      { name: 'decrement', label: 'Decrease playback speed' },
                    ]}
                    accessibilityState={{ disabled: !canAdjustPlaybackRate }}
                    disabled={!canAdjustPlaybackRate}
                    onAccessibilityAction={handlePlaybackRateAccessibilityAction}
                    onPress={cyclePlaybackRate}
                    className={`h-11 min-w-14 items-center justify-center rounded-pill bg-panel px-3 ${canAdjustPlaybackRate ? '' : 'opacity-50'}`}
                  >
                    <Text className="text-sm font-sans-bold text-ink">{currentPlaybackRate}×</Text>
                  </Pressable>
                </View>
                <View className="flex-1 flex-row items-center justify-center gap-7">
                  <View className="h-14 w-14 items-center justify-center rounded-pill bg-panel">
                    <IconButton
                      icon="skipBack"
                      label="Rewind 15 seconds"
                      kind="quiet"
                      disabled={!status.isLoaded}
                      onPress={handleSkipBack}
                    />
                  </View>
                  <IconButton
                    icon={status.playing ? 'pause' : 'play'}
                    label={status.playing ? 'Pause' : 'Play'}
                    kind="primary"
                    size="large"
                    disabled={!status.isLoaded}
                    onPress={handlePlayPause}
                  />
                  <View className="h-14 w-14 items-center justify-center rounded-pill bg-panel">
                    <IconButton
                      icon="skipForward"
                      label="Skip forward 15 seconds"
                      kind="quiet"
                      disabled={!status.isLoaded}
                      onPress={handleSkipForward}
                    />
                  </View>
                </View>
                <View className="w-16 items-end">
                  <IconButton
                    icon="sleepTimer"
                    label={
                      sleepTimerRemaining == null
                        ? 'Set sleep timer'
                        : `Sleep timer, ${formatAudioTime(sleepTimerRemaining)} remaining`
                    }
                    kind={sleepTimerRemaining == null ? 'quiet' : 'secondary'}
                    disabled={!status.isLoaded}
                    onPress={() => setSleepTimerOpen(true)}
                  />
                </View>
              </View>
              {sleepTimerRemaining != null ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="mt-3 text-center text-xs font-sans-semibold text-muted"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  Sleep timer · {formatAudioTime(sleepTimerRemaining)} remaining
                </Text>
              ) : null}
              <View className="mt-9 w-full gap-3 border-t border-line-subtle pt-6">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-[11px] font-sans-bold uppercase tracking-[1.5px] text-subtle">
                    Read Along
                  </Text>
                  <StatusBadge
                    tone={passage?.active ? 'success' : 'neutral'}
                    icon={passage?.active ? 'synced' : undefined}
                    label={passage?.active ? 'Synced' : passage ? 'Up next' : 'Audio only'}
                  />
                </View>
                {passage ? (
                  <View className="gap-4 rounded-card bg-paper p-5 shadow-xs">
                    <Animated.View key={passage.current.id} entering={passageEntrance}>
                      <Text
                        accessibilityLabel={`${passage.active ? 'Current' : 'Upcoming'} passage: ${passage.current.text}`}
                        numberOfLines={6}
                        className={
                          passage.active
                            ? 'font-reading text-lg leading-7 text-ink'
                            : 'font-reading text-base leading-6 text-muted'
                        }
                      >
                        {passage.current.text}
                      </Text>
                    </Animated.View>
                    {passage.next || passage.following ? (
                      <View className="gap-2 border-t border-line-subtle pt-3">
                        <Text className="text-[11px] font-sans-semibold uppercase tracking-wide text-subtle">
                          Coming next
                        </Text>
                        {[passage.next, passage.following].map((segment) =>
                          segment ? (
                            <Text
                              key={segment.id}
                              numberOfLines={2}
                              className="font-reading text-sm leading-5 text-subtle"
                            >
                              {segment.text}
                            </Text>
                          ) : null,
                        )}
                      </View>
                    ) : null}
                    <View className="items-start pt-1">
                      <Button
                        label={passage.active ? 'Open in book' : 'Text coming up'}
                        icon="read"
                        disabled={!passage.active}
                        onPress={() => void switchToRead()}
                      />
                    </View>
                  </View>
                ) : (
                  <Text className="pt-1 text-sm leading-5 text-muted">
                    Synchronized text is not available at this moment. Listening continues normally.
                  </Text>
                )}
              </View>
            </View>
          </ScrollView>
        ) : (
          <View className="flex-1 items-center justify-center p-8">
            <EmptyState icon="listen" title="No audiobook available">
              This Work doesn&apos;t have a listenable edition yet.
            </EmptyState>
          </View>
        )
      ) : null}
    </View>
  );
}

function preferencesFromState(state?: RepresentationState | null): ReaderPreferences {
  return {
    layout: state?.reader_layout ?? DEFAULT_READER_PREFERENCES.layout,
    zoom: state?.zoom ?? DEFAULT_READER_PREFERENCES.zoom,
    lineHeight: state?.line_height ?? DEFAULT_READER_PREFERENCES.lineHeight,
    margin: state?.margin ?? DEFAULT_READER_PREFERENCES.margin,
    theme: state?.reader_theme ?? DEFAULT_READER_PREFERENCES.theme,
  };
}
