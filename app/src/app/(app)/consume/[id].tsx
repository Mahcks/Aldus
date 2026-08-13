import type {
  Alignment,
  AudioLocator,
  CanonicalPosition,
  RepresentationState,
  Work,
} from '../../../generated/api';
import type { AudioSource } from 'expo-audio';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessibilityActionEvent, GestureResponderEvent } from 'react-native';
import { Platform } from 'react-native';
import {
  EPUBReader,
  type EPUBReaderHandle,
  type ReaderLocation,
} from '../../../components/EPUBReader';
import { commitsReadingProgress } from '../../../components/reader-location';
import { BookCover } from '../../../features/bookshelf';
import {
  applyPlaybackRate,
  choices,
  clampAudioPosition,
  defaultPair,
  listenToRead,
  readToListen,
  readyJob,
  PLAYBACK_RATES,
  synchronizationLabel,
  type MediaChoice,
} from '../../../features/consumption';
import { Button, IconButton, Loading, Notice } from '../../../features/ui';
import { Pressable, Text, View } from '../../../features/tw';
import { APIError, api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';
import { productAudioSource } from '../../../lib/media';

type Mode = 'read' | 'listen';

export default function ConsumeWorkScreen() {
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
    if (restoredAudio.current === `${audioID}:${initialAudioMS}`) return;
    restoredAudio.current = `${audioID}:${initialAudioMS}`;
    void (async () => {
      await player.seekTo(initialAudioMS / 1000, 0, 0);
      applyPlaybackRate(player, audioState?.playback_speed);
      setAudioReady(true);
    })();
  }, [status.isLoaded, initialAudioMS, audioID, audioState?.playback_speed, player]);

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
              reader_layout: 'paginated',
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
        await player.seekTo(target.timestamp_ms / 1000, 0, 0);
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
    void player.seekTo(clampAudioPosition(targetSeconds, status.duration));
  }
  function handleSkipBack() {
    void player.seekTo(Math.max(0, status.currentTime - 15));
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
    seekToSeconds((event.nativeEvent.locationX / trackWidth) * status.duration);
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
    <View className="min-h-full flex-1 bg-canvas">
      <View className="min-h-[70px] flex-row items-center gap-3.5 border-b border-line bg-paper px-4 py-2.5">
        <IconButton
          icon="back"
          label="Back to work"
          kind="quiet"
          onPress={() => goBackOr(`/work/${params.id}`)}
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-lg font-extrabold text-ink">
            {work.title}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
            {work.author || 'Unknown author'}
          </Text>
        </View>
        <View className="flex-row gap-2">
          {selectedEPUB ? (
            <Button
              label="Read"
              icon="read"
              kind={mode === 'read' ? 'primary' : 'secondary'}
              onPress={() => setMode('read')}
            />
          ) : null}
          {selectedAudio ? (
            <Button
              label="Listen"
              icon="listen"
              kind={mode === 'listen' ? 'primary' : 'secondary'}
              onPress={() => setMode('listen')}
            />
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
      {mode === 'read' ? (
        selectedEPUB && epubBlob ? (
          <View className="w-full max-w-[1100px] flex-1 self-center px-4 pt-2.5">
            <EPUBReader
              ref={reader}
              source={epubBlob}
              product
              segments={alignment?.segments}
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
        <View className="w-full max-w-[620px] flex-1 items-center justify-center gap-2.5 self-center p-6">
          <BookCover title={work.title} author={work.author} compact />
          <Text className="mt-4 text-center font-editorial text-2xl font-bold leading-8 text-ink">
            {work.title}
          </Text>
          <Text className="text-sm text-ink">{work.author || 'Unknown author'}</Text>
          <Text className="text-[13px] text-muted">{selectedAudio.representation.label}</Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Audiobook position"
            accessibilityValue={{
              min: 0,
              max: Math.round(status.duration),
              now: Math.round(status.currentTime),
              text: `${formatTime(status.currentTime)} of ${formatTime(status.duration)}`,
            }}
            accessibilityActions={[
              { name: 'increment', label: 'Skip ahead 5 seconds' },
              { name: 'decrement', label: 'Skip back 5 seconds' },
            ]}
            accessibilityState={{ disabled: !status.isLoaded }}
            disabled={!status.isLoaded}
            focusable
            onAccessibilityAction={handleScrubberAccessibilityAction}
            className="mt-[18px] h-11 w-full justify-center border-b-4 border-panel-strong focus:border-focus"
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={handleScrubberPress}
            {...scrubberKeyboardProps}
          >
            <View
              className="absolute -bottom-1 left-0 h-1 bg-accent"
              style={{
                width: `${status.duration ? Math.min(100, (status.currentTime / status.duration) * 100) : 0}%`,
              }}
            />
          </Pressable>
          <View className="w-full flex-row justify-between">
            <Text className="text-[13px] text-ink" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(status.currentTime)}
            </Text>
            <Text className="text-[13px] text-muted" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(status.duration)}
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
        </View>
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
function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
