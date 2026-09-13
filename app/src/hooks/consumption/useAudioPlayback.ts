import { useEffect, useState } from 'react';
import { Platform, type AccessibilityActionEvent } from 'react-native';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioSource,
} from 'expo-audio';
import type { Alignment, AudioChapter, Work } from '@/generated/api';
import {
  applyPlaybackRate,
  audioChapterAt,
  clampAudioPosition,
  playableAudioDuration,
  PLAYBACK_RATES,
  type MediaChoice,
} from '@/lib/consumption/consumption';
import { rememberOfflineAudioDuration } from '@/lib/offline-library';
import { errorMessage } from '@/lib/api';

export function useAudioPlayback({
  source,
  work,
  selectedAudio,
  audioChapters,
  alignment,
  onSave,
  setNotice,
}: {
  source: AudioSource;
  work: Work | undefined;
  selectedAudio: MediaChoice | undefined;
  audioChapters: AudioChapter[];
  alignment: Alignment | undefined;
  onSave: (timestampMS: number, speed?: number) => Promise<boolean>;
  setNotice: (notice: string) => void;
}) {
  const [currentPlaybackRate, setCurrentPlaybackRate] =
    useState<(typeof PLAYBACK_RATES)[number]>(1);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const alignedDuration = Math.max(
    0,
    ...(alignment?.segments.map((segment) => segment.audio_end_ms / 1000) ?? []),
  );
  const audioDuration = playableAudioDuration(status.duration, alignedDuration);
  useEffect(() => {
    if (!work?.id || !selectedAudio?.id || !status.isLoaded || status.duration <= 0) return;
    void rememberOfflineAudioDuration(work.id, selectedAudio.id, status.duration * 1000).catch(
      () => {
        // Display metadata is optional; exact progress is saved independently.
      },
    );
  }, [work?.id, selectedAudio?.id, status.isLoaded, status.duration]);
  const chapter = audioChapterAt(audioChapters, status.currentTime * 1000);
  const currentChapterTitle = chapter?.current.title;
  const playbackRateIndex = PLAYBACK_RATES.indexOf(currentPlaybackRate);
  const canAdjustPlaybackRate = Boolean(source) && !status.error;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => setNotice('Aldus could not configure background audio on this device.'));
  }, [setNotice]);

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
      void onSave(Math.round(player.currentTime * 1000));
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

  async function handleScrubberSeek(target: number) {
    try {
      await player.seekTo(clampAudioPosition(target, audioDuration), 0, 0);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  function handlePlaybackRate(rate: number) {
    if (!canAdjustPlaybackRate) return;
    try {
      const next = applyPlaybackRate(player, rate);
      setCurrentPlaybackRate(next);
      void onSave(Math.round(status.currentTime * 1000), next);
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

  return {
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
  };
}
