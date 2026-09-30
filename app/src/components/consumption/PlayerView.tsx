import { fallbackCoverURL } from '@/lib/catalog/cover-artwork';
import { AudioScrubber } from './AudioScrubber';
import { ReadAlongPanel } from './ReadAlongPanel';
import { ReadAlongUnavailableSheet } from './ReadAlongUnavailableSheet';
import type { AudioChapter, Work } from '@/generated/api';
import { useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState, type ReactNode } from 'react';
import type { AccessibilityActionEvent } from 'react-native';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookCover, coverPresentation } from '@/components/catalog/bookshelf';
import {
  audioChapterAt,
  audioPassage,
  formatAudioTime,
  type MediaChoice,
} from '@/lib/consumption/consumption';
import { useReadAlongEnabled } from '@/lib/consumption/read-along-preference';
import { EmptyState, IconButton, Loading, Notice } from '@/components/ui';
import { layoutShift, textSwapEnter, textSwapExit } from '@/components/ui/motion';
import { AnimatedView, Pressable, ScrollView, Text, View } from '@/components/ui/tw';

// Header padding (16 top + 8 bottom) plus the gap between the cover and the title block (20).
const COVER_SPACING = 44;
const MIN_COVER_HEIGHT = 120;
// With a notice above it the cover gives up room first, so the controls never leave the screen.
const PAUSED_MIN_COVER_HEIGHT = 72;

type PlayerViewProps = {
  selectedAudio: MediaChoice | undefined;
  work: Work;
  /** Whether this work has a reading edition, so the sync prompt can say what's missing. */
  hasEbook: boolean;
  passage: ReturnType<typeof audioPassage>;
  status: ReturnType<typeof useAudioPlayerStatus>;
  restoringPlace: boolean;
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
  /** When set, the session moved to another device: controls disable and this explains why. */
  pausedReason?: string;
  /** Shown above the cover when another device took over, inside the page so the cover shrinks to fit. */
  pausedNotice?: ReactNode;
  sleepTimerRemaining: number | undefined;
  setSleepTimerOpen: (open: boolean) => void;
};

/** How long to wait for the art to report its shape before showing the cover anyway. */
const ART_SETTLE_MS = 600;

/** The longest the cover stays hidden while its size and header mode settle. */
const COVER_WAIT_MS = 1500;

/** Covers `layoutShift` (380ms) plus a frame of slack for the new layout to land. */
const HEADER_SWITCH_MS = 450;

export function PlayerView({
  selectedAudio,
  work,
  hasEbook,
  passage,
  status,
  restoringPlace,
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
  pausedReason,
  pausedNotice,
  sleepTimerRemaining,
  setSleepTimerOpen,
}: PlayerViewProps) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [audioScrubbing, setAudioScrubbing] = useState(false);
  const [listeningHeight, setListeningHeight] = useState(0);
  // Space above the fixed controls, and the height of the title block under the cover.
  const [topHeight, setTopHeight] = useState(0);
  const [textHeight, setTextHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const [readAlongEnabled, setReadAlongEnabled] = useReadAlongEnabled();
  const [syncPromptOpen, setSyncPromptOpen] = useState(false);
  // Audiobook art is often a portrait book jacket, not a square; the frame follows the art.
  const [artRatio, setArtRatio] = useState(1);
  // The cover's size settles from measurements and the art's real shape just after mount. It
  // stays invisible until then and fades in once, instead of visibly jumping between sizes.
  const [artSettled, setArtSettled] = useState(false);
  const [coverWaitExpired, setCoverWaitExpired] = useState(false);
  useEffect(() => {
    // Fallback art, or art that fails to load, never reports a shape.
    const artTimer = setTimeout(() => setArtSettled(true), ART_SETTLE_MS);
    // Never keep the cover hidden for long, whatever is still settling (e.g. audio not loading).
    const coverTimer = setTimeout(() => setCoverWaitExpired(true), COVER_WAIT_MS);
    return () => {
      clearTimeout(artTimer);
      clearTimeout(coverTimer);
    };
  }, []);
  // What the listener has chosen, for a synced book.
  const readAlongOn = Boolean(passage) && readAlongEnabled;
  // While another device has the book, the text (and its stale place) gives way to a compact header.
  const showReadAlong = readAlongOn && status.isLoaded && !restoringPlace && !pausedNotice;
  const compactHeader = showReadAlong || Boolean(pausedNotice);
  // The glide is only for switching between the full and compact header. The cover's opening
  // size settles from measurements and the art's real shape a moment after mount; animating
  // those made the cover stretch and then shrink toward the corner, so they apply instantly.
  const [animatedHeader, setAnimatedHeader] = useState(compactHeader);
  const [headerSwitching, setHeaderSwitching] = useState(false);
  if (animatedHeader !== compactHeader) {
    setAnimatedHeader(compactHeader);
    setHeaderSwitching(true);
  }
  useEffect(() => {
    if (!headerSwitching) return;
    const timer = setTimeout(() => setHeaderSwitching(false), HEADER_SWITCH_MS);
    return () => clearTimeout(timer);
  }, [headerSwitching]);
  // Web layout transitions animate a scaled snapshot. Animating both the header block and the
  // cover inside it compounded the two scales and stretched the art, so on web only the cover
  // glides (keeping its shape) while the block itself switches instantly and the text crossfades.
  const headerLayout = headerSwitching && Platform.OS !== 'web' ? layoutShift : undefined;
  const coverLayout = headerSwitching ? layoutShift : undefined;
  const controlsLocked = restoringPlace || Boolean(pausedReason);
  // Leave room for the header, home indicator, and large text; short screens can scroll.
  const listeningContentHeight = Math.max(
    620 * Math.max(1, fontScale),
    listeningHeight - insets.bottom - 40,
  );
  // The scrubber and controls are pinned to the bottom of a fixed-height page in both modes, so
  // they never move; the cover takes whatever room is left above them.
  const coverRoom = topHeight - textHeight - COVER_SPACING;
  const fittedCoverHeight =
    topHeight > 0 && textHeight > 0
      ? Math.max(pausedNotice ? PAUSED_MIN_COVER_HEIGHT : MIN_COVER_HEIGHT, coverRoom)
      : Math.round(listeningContentHeight * 0.4);
  const coverHeight = compactHeader ? 64 : fittedCoverHeight;
  // A synced book opens into read-along a moment later; showing the full cover first would
  // flash it large and then snap it small, so wait for that switch too, up to a limit.
  const readAlongPending = readAlongOn && (restoringPlace || !status.isLoaded) && !pausedNotice;
  const coverReady =
    coverWaitExpired ||
    (artSettled && topHeight > 0 && (compactHeader || textHeight > 0) && !readAlongPending);
  const coverWidth = compactHeader
    ? Math.round(Math.min(96, 64 * artRatio))
    : Math.round(Math.min(windowWidth - 40, 340, coverHeight * artRatio));

  function handleArtLoad({ width, height }: { width: number; height: number }) {
    if (width > 0 && height > 0) setArtRatio(Math.min(2, Math.max(0.5, width / height)));
    setArtSettled(true);
  }

  // Unsynced books keep the button but explain on press, so they never carry a standing warning.
  function handleReadAlongPress() {
    if (!passage) setSyncPromptOpen(true);
    else setReadAlongEnabled(!readAlongEnabled);
  }

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
        style={{ height: listeningContentHeight }}
      >
        {pausedNotice ? <View className="pb-3 pt-1">{pausedNotice}</View> : null}
        <View
          className={`min-h-0 flex-1 ${showReadAlong ? '' : 'justify-center'}`}
          onLayout={(event) => setTopHeight(event.nativeEvent.layout.height)}
        >
          <AnimatedView
            layout={headerLayout}
            className={
              compactHeader ? 'flex-row items-center gap-4 py-2' : 'items-center gap-5 pb-2 pt-4'
            }
          >
            <AnimatedView
              layout={coverLayout}
              style={{ width: coverWidth, opacity: coverReady ? 1 : 0 }}
              className="transition-opacity duration-200 motion-reduce:transition-none"
            >
              <BookCover
                title={work.title}
                author={work.author}
                coverURL={work.audiobook_cover_url || `/api/media/${selectedAudio.id}/cover`}
                fallbackCoverURL={fallbackCoverURL(work, 'audiobook')}
                size="grid"
                aspectRatio={artRatio}
                {...coverPresentation(work)}
                coverFit="contain"
                onImageLoad={handleArtLoad}
              />
            </AnimatedView>
            <AnimatedView
              key={compactHeader ? 'compact' : 'full'}
              entering={textSwapEnter}
              exiting={textSwapExit}
              onLayout={(event) => {
                if (!compactHeader) setTextHeight(event.nativeEvent.layout.height);
              }}
              className={compactHeader ? 'min-w-0 flex-1 gap-1' : 'w-full items-center gap-1.5'}
            >
              <Text
                numberOfLines={2}
                className={`${compactHeader ? 'text-lg leading-6' : 'text-center text-[26px] leading-8'} font-editorial text-ink`}
              >
                {work.title}
              </Text>
              <Text
                numberOfLines={1}
                className={`text-sm text-text-secondary ${compactHeader ? '' : 'text-center'}`}
              >
                {work.author || 'Unknown author'}
              </Text>
              <Text
                numberOfLines={2}
                className={
                  compactHeader ? 'mt-1 text-xs text-muted' : 'text-center text-sm text-muted'
                }
              >
                {selectedAudio.representation.label}
              </Text>
              {progressStatus ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className={`pt-1 text-xs font-sans-semibold text-muted ${compactHeader ? '' : 'text-center'}`}
                >
                  {progressStatus}
                </Text>
              ) : null}
            </AnimatedView>
          </AnimatedView>
          {showReadAlong && passage ? (
            <ReadAlongPanel
              passage={passage}
              timestampMS={status.currentTime * 1000}
              scrollEnabled={!audioScrubbing}
              onSeek={handleScrubberSeek}
            />
          ) : null}
        </View>
        {status.error ? (
          <View className="mt-5">
            <Notice danger>The audiobook could not be opened on this device.</Notice>
          </View>
        ) : !status.isLoaded || restoringPlace ? (
          <View className="mt-auto w-full pt-6">
            <Loading
              layout="controls"
              label={restoringPlace ? 'Opening your listening place…' : 'Loading audiobook…'}
            />
          </View>
        ) : null}
        {(status.isLoaded && !restoringPlace) || status.error ? (
          <>
            <View className="w-full gap-1 pt-4">
              <AudioScrubber
                key={audioID}
                position={status.currentTime}
                duration={audioDuration}
                enabled={status.isLoaded && !controlsLocked}
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
                  disabled={!chapter.previous || controlsLocked}
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
                  disabled={!chapter.next || controlsLocked}
                  onPress={handleNextChapter}
                />
              </View>
            ) : null}
            <View className="mt-5 w-full flex-row items-center justify-center gap-10">
              <IconButton
                icon="skipBack"
                label="Rewind 15 seconds"
                kind="quiet"
                disabled={!status.isLoaded || controlsLocked}
                onPress={handleSkipBack}
              />
              <IconButton
                icon={status.playing ? 'pause' : 'play'}
                label={status.playing ? 'Pause' : 'Play'}
                kind="primary"
                size="large"
                disabled={!status.isLoaded || controlsLocked}
                onPress={handlePlayPause}
              />
              <IconButton
                icon="skipForward"
                label="Skip forward 15 seconds"
                kind="quiet"
                disabled={!status.isLoaded || controlsLocked}
                onPress={handleSkipForward}
              />
            </View>
            <View className="mt-3 w-full flex-row items-center justify-around">
              <Pressable
                accessibilityRole="adjustable"
                accessibilityLabel="Playback speed"
                accessibilityHint="Cycles through playback speeds"
                accessibilityValue={{ text: `${currentPlaybackRate} times` }}
                accessibilityActions={[
                  { name: 'increment', label: 'Increase playback speed' },
                  { name: 'decrement', label: 'Decrease playback speed' },
                ]}
                accessibilityState={{ disabled: !canAdjustPlaybackRate || controlsLocked }}
                disabled={!canAdjustPlaybackRate || controlsLocked}
                onAccessibilityAction={handlePlaybackRateAccessibilityAction}
                onPress={cyclePlaybackRate}
                className={`will-change-variable h-11 min-w-12 items-center justify-center rounded-pill bg-panel px-2 ${canAdjustPlaybackRate && !controlsLocked ? '' : 'opacity-50'}`}
              >
                <Text className="text-sm font-sans-bold text-ink">{currentPlaybackRate}×</Text>
              </Pressable>
              <IconButton
                icon="sleepTimer"
                label={
                  sleepTimerRemaining == null
                    ? 'Set sleep timer'
                    : `Sleep timer, ${formatAudioTime(sleepTimerRemaining)} remaining`
                }
                kind={sleepTimerRemaining == null ? 'quiet' : 'secondary'}
                disabled={!status.isLoaded || controlsLocked}
                onPress={() => setSleepTimerOpen(true)}
              />
              <View className={passage ? undefined : 'opacity-60'}>
                <IconButton
                  icon="readAlong"
                  label="Read along"
                  kind="quiet"
                  selected={showReadAlong}
                  pressed={showReadAlong}
                  onPress={handleReadAlongPress}
                />
              </View>
            </View>
          </>
        ) : null}
        {pausedReason ? (
          <Text accessibilityLiveRegion="polite" className="mt-3 text-center text-sm text-muted">
            {pausedReason}
          </Text>
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
      <ReadAlongUnavailableSheet
        visible={syncPromptOpen}
        onClose={() => setSyncPromptOpen(false)}
        workID={work.id}
        libraryID={work.library_id}
        hasEbook={hasEbook}
      />
    </ScrollView>
  ) : (
    <View className="flex-1 items-center justify-center p-8">
      <EmptyState icon="listen" title="No audiobook available">
        This Work doesn&apos;t have a listenable edition yet.
      </EmptyState>
    </View>
  );
}
