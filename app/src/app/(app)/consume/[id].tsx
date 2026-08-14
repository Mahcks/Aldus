import type {
  Alignment,
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
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_READER_PREFERENCES,
  EPUBReader,
  type EPUBReaderHandle,
  type ReaderLocation,
  type ReaderPreferences,
} from '../../../components/EPUBReader';
import { commitsReadingProgress } from '../../../components/reader-location';
import { BookCover } from '../../../features/bookshelf';
import { ReaderSettings } from '../../../features/reader-settings';
import {
  applyPlaybackRate,
  choices,
  clampAudioPosition,
  defaultPair,
  listenToRead,
  playableAudioDuration,
  readToListen,
  readyJob,
  scrubberPosition,
  PLAYBACK_RATES,
  synchronizationLabel,
  type MediaChoice,
} from '../../../features/consumption';
import { Button, IconButton, Loading, Notice } from '../../../features/ui';
import { Pressable, ScrollView, Text, View } from '../../../features/tw';
import { APIError, api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';
import { productAudioSource } from '../../../lib/media';

type Mode = 'read' | 'listen';

export default function ConsumeWorkScreen() {
  const compact = useWindowDimensions().width < 600;
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; mode?: Mode; epub?: string; audio?: string }>();
  const [work, setWork] = useState<Work>();
  const [mode, setMode] = useState<Mode>(params.mode === 'listen' ? 'listen' : 'read');
  const [epubs, setEPUBs] = useState<MediaChoice[]>([]);
  const [audio, setAudio] = useState<MediaChoice[]>([]);
  const [epubID, setEPUBID] = useState(params.epub ?? '');
  const [audioID, setAudioID] = useState(params.audio ?? '');
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.alignmentJobs>>>([]);
  const [alignment, setAlignment] = useState<Alignment>();
  const [progress, setProgress] = useState<CanonicalPosition | null>(null);
  const [epubState, setEPUBState] = useState<RepresentationState | null>(null);
  const [audioState, setAudioState] = useState<RepresentationState | null>(null);
  const [epubBlob, setEPUBBlob] = useState<Blob>();
  const [source, setSource] = useState<AudioSource>(null);
  const [readerLocation, setReaderLocation] = useState<ReaderLocation>();
  const [readerTarget, setReaderTarget] = useState<unknown>();
  const [readerCommit, setReaderCommit] = useState<ReaderLocation>();
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [initialAudioMS, setInitialAudioMS] = useState<number>();
  const [trackWidth, setTrackWidth] = useState(1);
  const [syncAvailable, setSyncAvailable] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const reader = useRef<EPUBReaderHandle>(null);
  const readerReady = useRef(false);
  const restoredAudio = useRef('');
  const lastAudioSave = useRef(-1);
  const progressRef = useRef<CanonicalPosition | null>(null);
  const canonicalSaves = useRef<Promise<void>>(Promise.resolve());
  const switching = useRef(false);
  const player = useAudioPlayer(source, { updateInterval: 500 });
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

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => setNotice('Aldus could not configure background audio on this device.'));
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !status.isLoaded || !work || !selectedAudio) return;
    try {
      player.setActiveForLockScreen(true, {
        title: work.title,
        artist: work.author || 'Unknown author',
        albumTitle: selectedAudio.representation.label,
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
  }, [player, status.isLoaded, selectedAudio, work]);

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!params.id) return;
      try {
        const [nextWork, representations, nextJobs, nextProgress] = await Promise.all([
          api.work(params.id),
          api.representations(params.id),
          api.alignmentJobs(params.id),
          api.workProgress(params.id),
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
        const pair = defaultPair(nextJobs, nextEPUBs, nextAudio, nextProgress?.alignment_id);
        const nextEPUB = nextEPUBs.find((item) => item.id === params.epub) ?? pair.epub;
        const nextAudioChoice = nextAudio.find((item) => item.id === params.audio) ?? pair.audio;
        if (canceled) return;
        progressRef.current = nextProgress;
        setWork(nextWork);
        setEPUBs(nextEPUBs);
        setAudio(nextAudio);
        setJobs(nextJobs);
        setProgress(nextProgress);
        setEPUBID(nextEPUB?.id ?? '');
        setAudioID(nextAudioChoice?.id ?? '');
      } catch (error) {
        if (!canceled) setNotice(errorMessage(error));
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
      setAlignment(undefined);
      setReaderTarget(undefined);
      setInitialAudioMS(undefined);
      setSyncAvailable(false);
      setAudioReady(false);
      readerReady.current = false;
      try {
        const selectedJob = readyJob(jobs, epubID, audioID);
        const [nextEPUBState, nextAudioState, nextAlignment, blob, audioSource] = await Promise.all(
          [
            selectedEPUB ? api.representationState(selectedEPUB.representation.id) : null,
            selectedAudio ? api.representationState(selectedAudio.representation.id) : null,
            selectedJob?.alignment_id ? api.alignment(selectedJob.alignment_id) : undefined,
            selectedEPUB ? api.mediaBlob(selectedEPUB.id) : undefined,
            selectedAudio ? productAudioSource(selectedAudio.id) : null,
          ],
        );
        if (canceled) return;
        setEPUBState(nextEPUBState);
        setAudioState(nextAudioState);
        setAlignment(nextAlignment);
        setEPUBBlob(blob);
        setSource(audioSource);
        setReaderPreferences(preferencesFromState(nextEPUBState));
        const canonical =
          progress?.resolvable && progress.alignment_id === selectedJob?.alignment_id
            ? progress
            : null;
        if (canonical && selectedJob?.alignment_id) {
          try {
            const [epubTarget, audioTarget] = await Promise.all([
              api.canonicalToEPUB(selectedJob.alignment_id, canonical),
              api.canonicalToAudio(selectedJob.alignment_id, canonical),
            ]);
            if (!canceled) {
              setReaderTarget(epubTarget);
              setInitialAudioMS(audioTarget.timestamp_ms);
              setSyncAvailable(true);
            }
          } catch {
            if (!canceled) {
              setReaderTarget(nextEPUBState?.epub_locator);
              setInitialAudioMS(nextAudioState?.audio_timestamp_ms);
            }
          }
        } else {
          setReaderTarget(nextEPUBState?.epub_locator);
          setInitialAudioMS(nextAudioState?.audio_timestamp_ms);
        }
      } catch (error) {
        if (!canceled) setNotice(errorMessage(error));
      }
    }
    if (work) void loadSelection();
    return () => {
      canceled = true;
    };
    // Selection changes reload media; progress revision changes must not reload active playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, epubID, audioID, jobs, progress?.alignment_id, progress?.resolvable]);

  useEffect(() => {
    if (!readerReady.current || !readerTarget) return;
    void reader.current?.restoreLocation(
      readerTarget,
      Boolean(progress?.resolvable && progress.alignment_id === alignmentID),
    );
  }, [readerTarget, progress?.resolvable, progress?.alignment_id, alignmentID]);

  useEffect(() => {
    if (!status.isLoaded) return;
    if (initialAudioMS == null) return;
    if (audioDuration <= 0) return;
    if (restoredAudio.current === `${audioID}:${initialAudioMS}`) return;
    restoredAudio.current = `${audioID}:${initialAudioMS}`;
    void (async () => {
      await player.seekTo(clampAudioPosition(initialAudioMS / 1000, audioDuration), 0, 0);
      applyPlaybackRate(player, audioState?.playback_speed);
      setAudioReady(true);
    })();
  }, [status.isLoaded, audioDuration, initialAudioMS, audioID, audioState?.playback_speed, player]);

  const onReaderLocation = useCallback((location: ReaderLocation) => {
    setReaderLocation(location);
    if (commitsReadingProgress(location.reason)) setReaderCommit(location);
    setSyncAvailable(Boolean(location.sync));
  }, []);
  const onReaderReady = useCallback(() => {
    readerReady.current = true;
    if (readerTarget)
      void reader.current?.restoreLocation(
        readerTarget,
        Boolean(progress?.resolvable && progress.alignment_id === alignmentID),
      );
  }, [readerTarget, progress?.resolvable, progress?.alignment_id, alignmentID]);

  useEffect(() => {
    if (mode !== 'read' || !readerLocation || !selectedEPUB) return;
    const timer = setTimeout(() => {
      void saveRepresentation('epub', { href: readerLocation.href, cfi: readerLocation.cfi });
    }, 900);
    return () => clearTimeout(timer);
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
      } else setNotice(errorMessage(error));
    }
  }

  async function saveCanonical(canonical: CanonicalPosition) {
    if (!work || !alignmentID) return false;
    let saved = false;
    canonicalSaves.current = canonicalSaves.current
      .catch(() => {})
      .then(async () => {
        try {
          const next = await api.updateWorkProgress(work.id, {
            alignment_id: alignmentID,
            segment_id: canonical.segment_id,
            offset: canonical.offset,
            expected_revision: progressRef.current?.revision ?? 0,
            source_device: Platform.OS,
          });
          progressRef.current = next;
          setProgress(next);
          setSyncAvailable(true);
          saved = true;
        } catch (error) {
          if (error instanceof APIError && error.status === 409) {
            const current = await api.workProgress(work.id);
            progressRef.current = current;
            setProgress(current);
            setNotice('Progress changed on another device. The newer saved position was kept.');
          } else if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
          else setNotice(errorMessage(error));
        }
      })
      .catch((error) => {
        setNotice(errorMessage(error));
      });
    await canonicalSaves.current;
    return saved;
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
      if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
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
      await saveCanonical(await api.audioToCanonical(alignmentID, locator));
    } catch (error) {
      if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
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
      setInitialAudioMS(target.timestamp_ms);
      setMode('listen');
      setNotice('');
      if (status.isLoaded) {
        await player.seekTo(clampAudioPosition(target.timestamp_ms / 1000, audioDuration), 0, 0);
        setAudioReady(true);
        player.play();
      }
    } catch (error) {
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
      const { progress: next, target } = await listenToRead(
        api,
        work.id,
        alignmentID,
        {
          resource: alignment.segments[0].audio_resource,
          timestamp_ms: Math.round(status.currentTime * 1000),
        },
        progressRef.current?.revision ?? 0,
        Platform.OS,
      );
      if (__DEV__)
        console.debug('Aldus Listen → Read', {
          audio_timestamp_ms: Math.round(status.currentTime * 1000),
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
      void saveListeningPosition(Math.round(status.currentTime * 1000));
    } else {
      player.play();
    }
  }
  function handleSkipForward() {
    seekToSeconds(status.currentTime + 15);
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
    const next = applyPlaybackRate(player, rate);
    void saveRepresentation('audio', Math.round(status.currentTime * 1000), next);
  }
  const scrubberKeyboardProps = Platform.OS === 'web' ? { onKeyDown: handleScrubberKeyDown } : {};

  if (loading || !work)
    return loading ? (
      <Loading />
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
  const readerHelper = syncAvailable
    ? 'Continue with the narration at the marked passage.'
    : readerLocation?.syncState === 'partial'
      ? 'Move to synchronized text to continue listening.'
      : 'Synchronization is unavailable in this section.';
  return (
    <View className="min-h-full flex-1 bg-canvas" style={{ paddingBottom: insets.bottom }}>
      <View
        className="min-h-[62px] flex-row items-center gap-2 border-b border-line bg-paper px-3 pb-2"
        style={{ paddingTop: insets.top + 8 }}
      >
        <IconButton
          icon="back"
          label="Back to work"
          kind="quiet"
          onPress={() => goBackOr(`/work/${params.id}`)}
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-base font-extrabold text-ink">
            {compact ? (mode === 'read' ? 'Reading' : 'Listening') : work.title}
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
          {selectedEPUB ? (
            compact ? (
              <IconButton
                label="Read"
                icon="read"
                kind={mode === 'read' ? 'primary' : 'secondary'}
                selected={mode === 'read'}
                onPress={() => setMode('read')}
              />
            ) : (
              <Button
                label="Read"
                icon="read"
                kind={mode === 'read' ? 'primary' : 'secondary'}
                onPress={() => setMode('read')}
              />
            )
          ) : null}
          {selectedAudio ? (
            compact ? (
              <IconButton
                label="Listen"
                icon="listen"
                kind={mode === 'listen' ? 'primary' : 'secondary'}
                selected={mode === 'listen'}
                onPress={() => setMode('listen')}
              />
            ) : (
              <Button
                label="Listen"
                icon="listen"
                kind={mode === 'listen' ? 'primary' : 'secondary'}
                onPress={() => setMode('listen')}
              />
            )
          ) : null}
        </View>
      </View>
      <View className="min-h-[30px] items-center justify-center border-b border-line bg-panel">
        <Text className="text-xs font-semibold text-muted">
          {mode === 'read' && alignmentID
            ? pageSyncLabel
            : syncAvailable
              ? 'Synchronized here'
              : syncLabel}
        </Text>
      </View>
      {notice ? (
        <View className="px-5 pt-3">
          <Notice danger>{notice}</Notice>
        </View>
      ) : null}
      {mode === 'read' && settingsOpen ? (
        <ReaderSettings
          value={readerPreferences}
          disabled={settingsBusy}
          onChange={(next) => void updateReaderPreferences(next)}
        />
      ) : null}
      {mode === 'read' ? (
        selectedEPUB && epubBlob ? (
          <View className="w-full max-w-[1100px] flex-1 self-center px-4 pt-2.5">
            <EPUBReader
              ref={reader}
              source={epubBlob}
              product
              segments={alignment?.segments}
              preferences={readerPreferences}
              onLocation={onReaderLocation}
              onReady={onReaderReady}
              onError={(error) => setNotice(errorMessage(error))}
            />
            <View className="min-h-[62px] w-full flex-row items-center justify-between gap-3 border-t border-line py-2.5">
              <Text className="flex-1 text-[13px] leading-[19px] text-muted">{readerHelper}</Text>
              <Button
                label={syncAvailable ? 'Listen from here' : 'Listen unavailable here'}
                disabled={!syncAvailable}
                onPress={() => void switchToListen()}
              />
            </View>
          </View>
        ) : (
          <EmptyMode text="No EPUB is available for this Work." />
        )
      ) : selectedAudio ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="w-full max-w-[620px] flex-grow items-center justify-center gap-2.5 self-center p-6"
        >
          <BookCover title={work.title} author={work.author} size={compact ? 'continue' : 'hero'} />
          <Text numberOfLines={2} className="mt-3 text-center text-sm font-semibold text-muted">
            {selectedAudio.representation.label}
          </Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Audiobook position"
            accessibilityValue={{
              min: 0,
              max: Math.round(audioDuration),
              now: Math.round(status.currentTime),
              text: `${formatTime(status.currentTime)} of ${formatTime(audioDuration)}`,
            }}
            accessibilityActions={[
              { name: 'increment', label: 'Skip ahead 5 seconds' },
              { name: 'decrement', label: 'Skip back 5 seconds' },
            ]}
            accessibilityState={{ disabled: !status.isLoaded }}
            disabled={!status.isLoaded}
            focusable
            onAccessibilityAction={handleScrubberAccessibilityAction}
            className="mt-[18px] h-11 w-full justify-center border-b-4 border-panel-strong focus-visible:border-focus"
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={handleScrubberPress}
            {...scrubberKeyboardProps}
          >
            <View
              className="absolute -bottom-1 left-0 h-1 bg-accent"
              style={{
                width: `${audioDuration ? Math.min(100, (status.currentTime / audioDuration) * 100) : 0}%`,
              }}
            />
          </Pressable>
          <View className="w-full flex-row justify-between">
            <Text className="text-[13px] text-ink" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(status.currentTime)}
            </Text>
            <Text className="text-[13px] text-muted" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(audioDuration)}
            </Text>
          </View>
          <View className="my-2.5 flex-row flex-wrap items-center justify-center gap-3">
            <IconButton
              icon="skipBack"
              label="Rewind 15 seconds"
              disabled={!status.isLoaded}
              onPress={handleSkipBack}
            />
            <IconButton
              icon={status.playing ? 'pause' : 'play'}
              label={status.playing ? 'Pause' : 'Play'}
              kind="primary"
              size="large"
              disabled={!status.isLoaded}
              onPress={handlePlayPause}
            />
            <IconButton
              icon="skipForward"
              label="Skip forward 15 seconds"
              disabled={!status.isLoaded}
              onPress={handleSkipForward}
            />
          </View>
          <View className="items-center gap-2">
            <Text className="text-xs font-semibold text-muted">Playback speed</Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Playback speed"
              className="flex-row flex-wrap items-center justify-center gap-1.5"
            >
              {PLAYBACK_RATES.map((rate) => {
                const selected = status.playbackRate === rate;
                return (
                  <Button
                    key={rate}
                    label={`${rate}×`}
                    accessibilityRole="radio"
                    disabled={!status.isLoaded}
                    selected={selected}
                    onPress={() => handlePlaybackRate(rate)}
                  />
                );
              })}
            </View>
          </View>
          <View className="min-h-[62px] w-full flex-row items-center justify-between gap-3 border-t border-line py-2.5">
            <Text className="flex-1 text-[13px] leading-[19px] text-muted">
              {syncAvailable
                ? 'Return to the matching text.'
                : 'Playback continues without synchronized text here.'}
            </Text>
            <Button
              label={syncAvailable ? 'Read from here' : 'Read unavailable here'}
              disabled={!syncAvailable}
              onPress={() => void switchToRead()}
            />
          </View>
        </ScrollView>
      ) : (
        <EmptyMode text="No audiobook is available for this Work." />
      )}
    </View>
  );
}

function EmptyMode({ text }: { text: string }) {
  return (
    <View className="flex-1 items-center justify-center p-8">
      <Text className="text-[13px] leading-[19px] text-muted">{text}</Text>
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
function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
