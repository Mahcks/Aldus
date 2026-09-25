import { ReaderView } from '@/components/consumption/ReaderView';
import { PlayerView } from '@/components/consumption/PlayerView';
import { PassageHandoff } from '@/components/consumption/PassageHandoff';
import type { AudioChapter } from '@/generated/api';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_READER_PREFERENCES } from '@/components/consumption/reader/EPUBReader';
import { ReaderSettings } from '@/components/consumption/reader-settings';
import {
  formatAudioTime,
  progressSaveLabel,
  progressSourceLabel,
  SLEEP_TIMER_MINUTES,
  synchronizationLabel,
} from '@/lib/consumption/consumption';
import { fadeIn as passageEntrance } from '@/components/ui/motion';
import { Button, Dialog, IconButton, Loading, Notice, SearchField } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import { useConsumptionState } from '@/hooks/consumption/useConsumptionState';
import { useConsumptionActions } from '@/hooks/consumption/useConsumptionActions';
import { useConsumptionLoading } from '@/hooks/consumption/useConsumptionLoading';
import { useConsumptionSync } from '@/hooks/consumption/useConsumptionSync';

type Mode = 'read' | 'listen';
export default function ConsumeWorkScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const compact = windowWidth < 600;
  const compactNative = compact && Platform.OS !== 'web';
  const fullScreenSettings = compact || Platform.OS !== 'web';
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; mode?: Mode; epub?: string; audio?: string }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [readerSearchOpen, setReaderSearchOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const state = useConsumptionState(params, savePlaybackPosition);
  const panels = { setSettingsOpen, setContentsOpen, setReaderSearchOpen };
  const actions = useConsumptionActions(state, panels, params);
  useConsumptionLoading(state, params, panels);
  useConsumptionSync(state, actions);
  const {
    work,
    mode,
    audioChapters,
    epubID,
    audioID,
    jobs,
    alignment,
    epubSource,
    syncAvailable,
    notice,
    setNotice,
    editionConflict,
    resolvingEditionConflict,
    loading,
    mediaLoading,
    selectedEPUB,
    selectedAudio,
    status,
    audioDuration,
    chapter,
    currentPlaybackRate,
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
    saveState,
    resumeMessage,
    progressConflict,
    keepLocalProgress,
    acceptanceNetwork,
    readerLocation,
    readerTarget,
    readerContents,
    reader,
    readerRestoreError,
    setReaderRestoreError,
    canRetryRestore,
    restoreReader,
    onReaderLocation,
    onReaderReady,
    readerInteractionReady,
    readerPreferences,
    readerDefaults,
    readerCustomized,
    settingsBusy,
    updateReaderPreferences,
    updateReaderCustomization,
    readerSearchQuery,
    readerSearchResults,
    readerSearching,
    readerSearchRan,
    readerSearchError,
    runReaderSearch,
    changeReaderSearchQuery,
    canListenFromReader,
    passage,
    formatSwitchBusy,
  } = state;
  const {
    openReaderLocation,
    acceptRemoteProgress,
    resolveEditionConflict,
    switchToListen,
    leaveReader,
    handleReadMode,
    handleListenMode,
  } = actions;
  function savePlaybackPosition(timestampMS: number, speed?: number) {
    return actions.saveListeningPosition(timestampMS, speed);
  }

  function selectChapter(next: AudioChapter) {
    seekToSeconds(next.start_ms / 1000);
    setChaptersOpen(false);
  }

  if (loading || !work)
    return loading ? (
      <View className="flex-1 bg-canvas">
        <SafeAreaView>
          <View className="mx-auto w-full max-w-xl px-6">
            <Loading layout={mode === 'listen' ? 'player' : 'details'} label="Opening your book…" />
          </View>
        </SafeAreaView>
      </View>
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

  const saveLabel = progressSaveLabel(saveState, mode);
  const offlineReaderNotice = compactNative && mode === 'read' && notice.startsWith('Offline mode');
  const progressStatus = saveLabel || resumeMessage || (offlineReaderNotice ? 'Offline' : '');

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
          onPress={() => void leaveReader()}
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-base font-sans-bold text-ink">
            {mode === 'listen' ? 'Now playing' : work.title}
          </Text>
          {!compact && mode === 'read' ? (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
              {work.author || 'Unknown author'}
            </Text>
          ) : null}
        </View>
        <View className="flex-row gap-2">
          {mode === 'read' && selectedEPUB ? (
            <>
              {readerInteractionReady ? (
                <>
                  <IconButton
                    icon="contents"
                    label="Open table of contents"
                    kind="quiet"
                    onPress={() => setContentsOpen(true)}
                  />
                  <IconButton
                    icon="search"
                    label="Search inside book"
                    kind="quiet"
                    onPress={() => setReaderSearchOpen(true)}
                  />
                </>
              ) : null}
              {readerInteractionReady ? (
                <IconButton
                  icon="settings"
                  label={settingsOpen ? 'Close reader settings' : 'Open reader settings'}
                  kind="quiet"
                  selected={settingsOpen}
                  onPress={() => setSettingsOpen((open) => !open)}
                />
              ) : null}
            </>
          ) : null}
          {selectedEPUB && selectedAudio && (mode === 'listen' || readerInteractionReady) ? (
            <PassageHandoff
              mode={mode}
              busy={formatSwitchBusy}
              synchronized={
                mode === 'read'
                  ? Boolean(readerLocation?.sync && alignmentID)
                  : Boolean(alignmentID && status.isLoaded)
              }
              onPress={mode === 'read' ? handleListenMode : handleReadMode}
            />
          ) : null}
        </View>
      </View>
      {process.env.EXPO_PUBLIC_ALDUS_IOS_ACCEPTANCE === '1' ? (
        <View className="border-b border-line bg-paper px-3 py-1">
          <Button
            label={acceptanceNetwork.label}
            kind="quiet"
            disabled={acceptanceNetwork.busy}
            onPress={() => void acceptanceNetwork.toggle()}
          />
        </View>
      ) : null}
      {!compactNative && mode === 'read' && readerInteractionReady ? (
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
      {notice && !offlineReaderNotice ? (
        <View className="px-5 pt-3">
          <Notice danger>{notice}</Notice>
        </View>
      ) : null}
      {editionConflict ? (
        <View className="gap-3 border-b border-warning/30 bg-panel px-5 py-3">
          <Notice tone="warning">
            This edition has a different saved place on your server. Saving is paused until you
            choose which place to keep.
          </Notice>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Use server's saved place"
              disabled={resolvingEditionConflict}
              onPress={() => void resolveEditionConflict(false)}
            />
            <Button
              label="Keep this device's place"
              kind="secondary"
              disabled={resolvingEditionConflict}
              onPress={() => void resolveEditionConflict(true)}
            />
          </View>
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
      {mode === 'read' && settingsOpen && readerInteractionReady && !fullScreenSettings ? (
        <Animated.View entering={passageEntrance}>
          <ReaderSettings
            value={readerPreferences}
            resetValue={readerCustomized ? readerDefaults : DEFAULT_READER_PREFERENCES}
            customized={readerCustomized}
            disabled={settingsBusy}
            onChange={(next) => void updateReaderPreferences(next)}
            onCustomizedChange={(customized) => void updateReaderCustomization(customized)}
          />
        </Animated.View>
      ) : null}
      <Dialog
        visible={fullScreenSettings && mode === 'read' && settingsOpen && readerInteractionReady}
        onClose={() => setSettingsOpen(false)}
        title="Reading settings"
        fullScreen
        scrollHint="More settings below"
      >
        <ReaderSettings
          compact
          value={readerPreferences}
          resetValue={readerCustomized ? readerDefaults : DEFAULT_READER_PREFERENCES}
          customized={readerCustomized}
          disabled={settingsBusy}
          onChange={(next) => void updateReaderPreferences(next)}
          onCustomizedChange={(customized) => void updateReaderCustomization(customized)}
        />
      </Dialog>
      <Dialog
        visible={mode === 'read' && contentsOpen}
        onClose={() => setContentsOpen(false)}
        title="Contents"
      >
        <View className="gap-1">
          {readerContents.length === 0 ? (
            <Text className="text-sm text-muted">
              This ebook does not provide a table of contents.
            </Text>
          ) : null}
          {readerContents.map((item, index) => (
            <View key={`${item.title}-${index}`} style={{ paddingLeft: item.depth * 12 }}>
              <Button
                label={item.title}
                kind="quiet"
                onPress={() => void openReaderLocation(item.location)}
              />
            </View>
          ))}
        </View>
      </Dialog>
      <Dialog
        visible={mode === 'read' && readerSearchOpen}
        onClose={() => setReaderSearchOpen(false)}
        title="Search this book"
        wide
      >
        <View className="gap-4">
          <SearchField
            label="Words or phrase"
            value={readerSearchQuery}
            onChangeText={changeReaderSearchQuery}
            onSubmit={() => void runReaderSearch()}
            placeholder="Search inside this ebook"
          />
          <Button
            label={readerSearching ? 'Searching…' : 'Search'}
            icon="search"
            kind="primary"
            disabled={readerSearching || !readerSearchQuery.trim()}
            onPress={() => void runReaderSearch()}
          />
          {readerSearchError ? <Notice danger>{readerSearchError}</Notice> : null}
          {!readerSearching && readerSearchRan && readerSearchResults.length === 0 ? (
            <Text className="text-sm text-muted">No matches found.</Text>
          ) : null}
          <View className="gap-1">
            {readerSearchResults.map((item, index) => (
              <Button
                key={`${item.title}-${index}`}
                label={[item.title, item.excerpt].filter(Boolean).join(' · ')}
                kind="quiet"
                onPress={() => void openReaderLocation(item.location)}
              />
            ))}
          </View>
        </View>
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
      <ReaderView
        mode={mode}
        selectedEPUB={selectedEPUB}
        epubSource={epubSource}
        readerInteractionReady={readerInteractionReady}
        compactNative={compactNative}
        reader={reader}
        alignment={alignment}
        readerPreferences={readerPreferences}
        canListenFromReader={canListenFromReader}
        progressStatus={progressStatus}
        alignmentID={alignmentID}
        compactPageSyncLabel={compactPageSyncLabel}
        syncAvailable={syncAvailable}
        syncLabel={syncLabel}
        onReaderLocation={onReaderLocation}
        switchToListen={switchToListen}
        onReaderReady={onReaderReady}
        setReaderRestoreError={setReaderRestoreError}
        setNotice={setNotice}
        readerHelper={readerHelper}
        mediaLoading={mediaLoading}
        work={work}
        readerRestoreError={readerRestoreError}
        readerTarget={readerTarget}
        canRetryRestore={canRetryRestore}
        restoreReader={restoreReader}
        leaveReader={leaveReader}
      />
      {mode === 'listen' ? (
        <PlayerView
          selectedAudio={selectedAudio}
          work={work}
          hasEbook={Boolean(selectedEPUB)}
          passage={passage}
          status={status}
          progressStatus={progressStatus}
          audioID={audioID}
          audioDuration={audioDuration}
          handleScrubberSeek={handleScrubberSeek}
          chapter={chapter}
          handlePreviousChapter={handlePreviousChapter}
          handleNextChapter={handleNextChapter}
          setChaptersOpen={setChaptersOpen}
          audioChapters={audioChapters}
          currentPlaybackRate={currentPlaybackRate}
          canAdjustPlaybackRate={canAdjustPlaybackRate}
          handlePlaybackRateAccessibilityAction={handlePlaybackRateAccessibilityAction}
          cyclePlaybackRate={cyclePlaybackRate}
          handleSkipBack={handleSkipBack}
          handleSkipForward={handleSkipForward}
          handlePlayPause={handlePlayPause}
          sleepTimerRemaining={sleepTimerRemaining}
          setSleepTimerOpen={setSleepTimerOpen}
        />
      ) : null}
    </View>
  );
}
