import { fallbackCoverURL } from '@/lib/catalog/cover-artwork';
import { AudioScrubber } from './AudioScrubber';
import { ReadAlongPanel } from './ReadAlongPanel';
import type { AudioChapter, Work } from '@/generated/api';
import { useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import type { AccessibilityActionEvent } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookCover, coverPresentation } from '@/components/catalog/bookshelf';
import {
  audioChapterAt,
  audioPassage,
  formatAudioTime,
  type MediaChoice,
} from '@/lib/consumption/consumption';
import { EmptyState, IconButton, Loading, Notice } from '@/components/ui';
import { Pressable, ScrollView, Text, View } from '@/components/ui/tw';

type PlayerViewProps = {
  selectedAudio: MediaChoice | undefined;
  work: Work;
  passage: ReturnType<typeof audioPassage>;
  status: ReturnType<typeof useAudioPlayerStatus>;
  progressStatus: string;
  audioID: string;
  audioDuration: number;
  handleScrubberSeek: (target: number) => Promise<void>;
  chapter: ReturnType<typeof audioChapterAt>;
  handlePreviousChapter: () => void;
  handleNextChapter: () => void;
  setChaptersOpen: (open: boolean) => void;
  audioChapters: AudioChapter[];
  currentPlaybackRate: number;
  canAdjustPlaybackRate: boolean;
  handlePlaybackRateAccessibilityAction: (event: AccessibilityActionEvent) => void;
  cyclePlaybackRate: () => void;
  handleSkipBack: () => void;
  handleSkipForward: () => void;
  handlePlayPause: () => void;
  sleepTimerRemaining: number | undefined;
  setSleepTimerOpen: (open: boolean) => void;
};

export function PlayerView({
  selectedAudio,
  work,
  passage,
  status,
  progressStatus,
  audioID,
  audioDuration,
  handleScrubberSeek,
  chapter,
  handlePreviousChapter,
  handleNextChapter,
  setChaptersOpen,
  audioChapters,
  currentPlaybackRate,
  canAdjustPlaybackRate,
  handlePlaybackRateAccessibilityAction,
  cyclePlaybackRate,
  handleSkipBack,
  handleSkipForward,
  handlePlayPause,
  sleepTimerRemaining,
  setSleepTimerOpen,
}: PlayerViewProps) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [audioScrubbing, setAudioScrubbing] = useState(false);
  const [listeningHeight, setListeningHeight] = useState(0);
  const insets = useSafeAreaInsets();
  // Leave room for the header, home indicator, and large text; short screens can scroll.
  const listeningContentHeight = Math.max(
    620 * Math.max(1, fontScale),
    listeningHeight - insets.bottom - 40,
  );
  return selectedAudio ? (
    <ScrollView
      testID="audio-player-scroll"
      scrollEnabled={!audioScrubbing}
      bounces={false}
      alwaysBounceVertical={false}
      className="flex-1"
      onLayout={(event) => setListeningHeight(event.nativeEvent.layout.height)}
      contentContainerClassName="w-full flex-grow pt-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      <View
        className="mx-auto w-full max-w-[560px] px-5"
        style={{
          height: passage ? listeningContentHeight : undefined,
          minHeight: listeningContentHeight,
        }}
      >
        <View
          className={passage ? 'flex-row items-center gap-4 py-2' : 'items-center gap-7 pb-2 pt-6'}
        >
          <View
            className={passage ? 'w-14' : undefined}
            style={
              passage
                ? undefined
                : { width: Math.min(340, windowWidth - 64, listeningContentHeight * 0.4) }
            }
          >
            <BookCover
              title={work.title}
              author={work.author}
              coverURL={work.audiobook_cover_url || `/api/media/${selectedAudio.id}/cover`}
              fallbackCoverURL={fallbackCoverURL(work, 'audiobook')}
              size={passage ? 'mini' : 'audio'}
              square
              {...coverPresentation(work)}
              coverFit="cover"
            />
          </View>
          <View className={passage ? 'min-w-0 flex-1 gap-1' : 'w-full gap-2'}>
            <Text
              numberOfLines={2}
              className={`${passage ? 'text-lg leading-6' : 'text-[28px] leading-9'} font-editorial text-ink`}
            >
              {work.title}
            </Text>
            <Text numberOfLines={1} className="text-sm text-text-secondary">
              {work.author || 'Unknown author'}
            </Text>
            <Text
              numberOfLines={2}
              className={passage ? 'mt-1 text-xs text-muted' : 'text-sm text-muted'}
            >
              {selectedAudio.representation.label}
            </Text>
            {progressStatus ? (
              <Text
                accessibilityLiveRegion="polite"
                className="pt-1 text-xs font-sans-semibold text-muted"
              >
                {progressStatus}
              </Text>
            ) : null}
          </View>
        </View>
        {passage ? (
          <ReadAlongPanel
            passage={passage}
            playing={status.playing}
            scrollEnabled={!audioScrubbing}
          />
        ) : null}
        {status.error ? (
          <View className="mt-5">
            <Notice danger>The audiobook could not be opened on this device.</Notice>
          </View>
        ) : !status.isLoaded ? (
          <View className="mt-auto w-full pt-6">
            <Loading layout="controls" label="Loading audiobook…" />
          </View>
        ) : null}
        {status.isLoaded || status.error ? (
          <>
            <View className="mt-auto w-full gap-1 pt-6">
              <AudioScrubber
                key={audioID}
                position={status.currentTime}
                duration={audioDuration}
                enabled={status.isLoaded}
                onSeek={handleScrubberSeek}
                onScrubbingChange={setAudioScrubbing}
              />
            </View>
            {chapter ? (
              <View className="mt-4 w-full flex-row items-center gap-2 border-y border-line-subtle py-2">
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
                  className="min-h-11 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-control px-1 focus-visible:border focus-visible:border-focus"
                >
                  <Text numberOfLines={1} className="text-center text-sm font-sans-bold text-ink">
                    {chapter.current.title}
                  </Text>
                  <Text className="text-center text-[11px] font-sans-semibold uppercase tracking-[1px] text-subtle">
                    {chapter.index + 1} of {audioChapters.length} · View chapters
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
            <View className="mt-5 w-full flex-row items-center justify-between">
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
                className={`will-change-variable h-11 min-w-12 items-center justify-center rounded-pill bg-panel px-2 ${canAdjustPlaybackRate ? '' : 'opacity-50'}`}
              >
                <Text className="text-sm font-sans-bold text-ink">{currentPlaybackRate}×</Text>
              </Pressable>
              <IconButton
                icon="skipBack"
                label="Rewind 15 seconds"
                kind="quiet"
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
                kind="quiet"
                disabled={!status.isLoaded}
                onPress={handleSkipForward}
              />
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
          </>
        ) : null}
        {sleepTimerRemaining != null ? (
          <Text
            accessibilityLiveRegion="polite"
            className="mt-3 text-center text-xs font-sans-semibold text-muted"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            Sleep timer · {formatAudioTime(sleepTimerRemaining)} remaining
          </Text>
        ) : null}
      </View>
    </ScrollView>
  ) : (
    <View className="flex-1 items-center justify-center p-8">
      <EmptyState icon="listen" title="No audiobook available">
        This Work doesn&apos;t have a listenable edition yet.
      </EmptyState>
    </View>
  );
}
