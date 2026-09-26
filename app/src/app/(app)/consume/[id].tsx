import { conflictPlaceOptions } from '@/lib/consumption/handoff-places';
import { ReaderView } from '@/components/consumption/ReaderView';
import { PlayerView } from '@/components/consumption/PlayerView';
import { PassageHandoff } from '@/components/consumption/PassageHandoff';
import type { AudioChapter } from '@/generated/api';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_READER_PREFERENCES } from '@/components/consumption/reader/EPUBReader';
import { ReaderSettings } from '@/components/consumption/reader-settings';
import {
  formatAudioTime,
  progressSaveLabel,
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
import { useReadingSession, type ReadingSession } from '@/hooks/consumption/useReadingSession';
import { PausedElsewhereNotice } from '@/components/consumption/handoff/PausedElsewhereNotice';
import { ProgressStatus } from '@/components/consumption/handoff/HandoffStatus';
import { PlaceChoiceDialog } from '@/components/consumption/handoff/PlaceChoiceDialog';
import type { SavedPlaceOption, SaveStatusState } from '@/lib/consumption/handoff-copy';
import { TakeoverDialog } from '@/components/consumption/handoff/TakeoverDialog';
import { pausedCopy, saveStatusView } from '@/lib/consumption/handoff-copy';
import { api, errorMessage } from '@/lib/api';

type Mode = 'read' | 'listen';

/** The persistent paused notice already says this, so the transient error is not repeated. */
const OWNERSHIP_LOST_MESSAGE = 'This book continued on another device.';

/**
 * Decides whether this device may open the book before the reading or
 * listening screen mounts, and remounts that screen after a takeover so the
 * newly saved place is loaded by the same path as any other open.
 */
export default function ConsumeWorkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ReadingSessionGate key={id} workID={id} />;
}

function ReadingSessionGate({ workID }: { workID: string }) {
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const session = useReadingSession(workID);
  const [bookTitle, setBookTitle] = useState('This book');
  const promptOpen = session.takeoverView?.kind === 'prompt';

  useEffect(() => {
    if (!promptOpen) return;
    let cancelled = false;
    api
      .work(workID)
      .then((work) => {
        if (!cancelled) setBookTitle(work.title);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [promptOpen, workID]);

  return (
    <>
      {session.showsContent ? (
        <ConsumeWorkContent key={session.generation} session={session} />
      ) : (
        <ConsumeLoading mode={params.mode ?? 'read'} onBack={session.backToBook} />
      )}
      {session.takeoverView ? (
        <TakeoverDialog
          visible
          view={session.takeoverView}
          bookTitle={bookTitle}
          onContinue={session.continueHere}
          onNotNow={session.notNow}
          onRetry={session.retry}
          onCancel={session.cancel}
          onBackToBook={session.backToBook}
        />
      ) : null}
    </>
  );
}

function ConsumeLoading({ mode, onBack }: { mode: Mode; onBack: () => void }) {
  const { width: windowWidth } = useWindowDimensions();
  const compactNative = windowWidth < 600 && Platform.OS !== 'web';
  const insets = useSafeAreaInsets();

  if (mode !== 'listen') {
    return (
      <View className="flex-1 bg-canvas">
        <SafeAreaView>
          <View className="mx-auto w-full max-w-xl px-6">
            <Loading layout="details" label="Opening your book…" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

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
        <IconButton icon="back" label="Back to work" kind="quiet" onPress={onBack} />
        <Text numberOfLines={1} className="min-w-0 flex-1 text-base font-sans-bold text-ink">
          Now playing
        </Text>
      </View>
      <View
        className="mx-auto w-full max-w-[560px] flex-1 px-5"
        style={{ paddingBottom: insets.bottom + 24 }}
      >
        <Loading layout="player" label="Opening your book…" />
      </View>
    </View>
  );
}

function ConsumeWorkContent({ session }: { session: ReadingSession }) {
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
  useConsumptionLoading(state, params, panels, session.snapshot);
  useConsumptionSync(state, actions, session);
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
    player,
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

  const placeConflict = progressConflict ?? editionConflict;
  const [choice, setChoice] = useState<{
    conflict: typeof placeConflict;
    selected?: SavedPlaceOption['id'];
    deferred?: boolean;
  }>();
  const chosenPlace = choice?.conflict === placeConflict ? choice?.selected : undefined;
  const choiceDeferred = choice?.conflict === placeConflict && choice?.deferred;
  const [choiceBusy, setChoiceBusy] = useState(false);

  async function confirmPlace() {
    if (!chosenPlace || choiceBusy || !session.mayWrite) return;
    setChoiceBusy(true);
    setNotice('');
    try {
      if (!(await session.checkOwnership())) return;
      if (progressConflict) {
        if (chosenPlace === 'this-device') await keepLocalProgress();
        else await acceptRemoteProgress();
      } else if (editionConflict) {
        await resolveEditionConflict(chosenPlace === 'this-device');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setChoiceBusy(false);
    }
  }

  const { pausedDevice, bindRepresentations, contentReady, contentFailed } = session;
  const selectedEPUBRepresentationID = selectedEPUB?.representation.id ?? '';
  const selectedAudioRepresentationID = selectedAudio?.representation.id ?? '';

  useEffect(() => {
    bindRepresentations([selectedEPUBRepresentationID, selectedAudioRepresentationID]);
  }, [bindRepresentations, selectedEPUBRepresentationID, selectedAudioRepresentationID]);

  useEffect(() => {
    if (loading || mediaLoading) return;
    if (
      !work ||
      state.mediaLoadError ||
      readerRestoreError ||
      (mode === 'listen' && state.status.error)
    ) {
      contentFailed(
        notice.startsWith('This work is not downloaded') ? 'not-downloaded' : 'restore',
      );
      return;
    }
    const restored =
      mode === 'read'
        ? readerInteractionReady
        : state.status.isLoaded && (state.initialAudioMS == null || state.audioReady);
    if (restored) contentReady();
  }, [
    loading,
    mediaLoading,
    state.mediaLoadError,
    work,
    readerRestoreError,
    mode,
    state.status.error,
    state.status.isLoaded,
    state.initialAudioMS,
    state.audioReady,
    readerInteractionReady,
    notice,
    contentReady,
    contentFailed,
  ]);

  useEffect(() => {
    if ((!session.mayWrite || progressConflict || editionConflict) && mode === 'listen')
      player.pause();
  }, [session.mayWrite, progressConflict, editionConflict, mode, player]);

  function selectChapter(next: AudioChapter) {
    seekToSeconds(next.start_ms / 1000);
    setChaptersOpen(false);
  }

  if (loading || !work)
    return loading ? (
      <ConsumeLoading mode={mode} onBack={() => void leaveReader()} />
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

  let currentSaveStatus: SaveStatusState | undefined;
  if (placeConflict || pausedDevice) currentSaveStatus = 'paused';
  else if (saveState === 'offline') currentSaveStatus = 'on-device';
  else if (saveState !== 'idle') currentSaveStatus = saveState;
  const saveLabel = progressSaveLabel(saveState, mode);
  const offlineReaderNotice = compactNative && mode === 'read' && notice.startsWith('Offline mode');
  const progressStatus =
    pausedDevice || placeConflict
      ? saveStatusView('paused', mode).label
      : saveState === 'offline'
        ? saveStatusView('on-device', mode).label
        : saveLabel || resumeMessage || (offlineReaderNotice ? 'Offline' : '');

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
          {mode === 'read' ? (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
              {work.author || 'Unknown author'}
            </Text>
          ) : null}
        </View>
        <View className="flex-row gap-2">
          {mode === 'read' && selectedEPUB ? (
            <>
              {readerInteractionReady && session.mayWrite ? (
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
              {readerInteractionReady && session.mayWrite ? (
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
          {session.mayWrite &&
          selectedEPUB &&
          selectedAudio &&
          (mode === 'listen' || readerInteractionReady) ? (
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
      {pausedDevice && mode === 'read' ? (
        <View className="mx-auto w-full max-w-[680px] px-4 pb-3 pt-3">
          <PausedElsewhereNotice
            surface="reader"
            device={pausedDevice}
            resuming={session.state.kind === 'claiming'}
            onResume={session.resume}
          />
        </View>
      ) : null}
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
      {!compactNative && mode === 'read' && readerInteractionReady && session.mayWrite ? (
        <View className="min-h-[30px] items-center justify-center">
          {currentSaveStatus ? (
            <View className="py-1">
              <ProgressStatus mode={mode} state={currentSaveStatus} />
            </View>
          ) : (
            <Text
              accessibilityLiveRegion="polite"
              className="text-xs font-sans-semibold text-muted"
            >
              {progressStatus ||
                (mode === 'read' && alignmentID
                  ? pageSyncLabel
                  : syncAvailable
                    ? 'Synchronized here'
                    : syncLabel)}
            </Text>
          )}
        </View>
      ) : null}
      {notice && !offlineReaderNotice && !(pausedDevice && notice === OWNERSHIP_LOST_MESSAGE) ? (
        <View className="px-5 pt-3">
          <Notice danger>{notice}</Notice>
        </View>
      ) : null}
      {(progressConflict || editionConflict) && session.mayWrite ? (
        <>
          {choiceDeferred ? (
            <View className="gap-2 px-5 py-3">
              <Notice tone="warning">
                Both places are kept. Saving is paused until you choose.
              </Notice>
              <Button
                label="Choose saved place"
                onPress={() => setChoice({ conflict: placeConflict })}
              />
            </View>
          ) : null}
          <PlaceChoiceDialog
            visible={!choiceDeferred}
            otherDevice={{
              label: 'your server',
              platform: 'other',
            }}
            options={conflictPlaceOptions(
              progressConflict,
              editionConflict,
              alignment?.segments ?? [],
              Platform.OS === 'web' || Platform.OS === 'ios' || Platform.OS === 'android'
                ? Platform.OS
                : 'other',
            )}
            selectedId={chosenPlace}
            error={notice || undefined}
            busy={choiceBusy || resolvingEditionConflict}
            onSelect={(selected) => setChoice({ conflict: placeConflict, selected })}
            onConfirm={() => void confirmPlace()}
            onDecideLater={() => setChoice({ conflict: placeConflict, deferred: true })}
          />
        </>
      ) : null}
      {mode === 'read' &&
      settingsOpen &&
      readerInteractionReady &&
      session.mayWrite &&
      !fullScreenSettings ? (
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
        visible={
          fullScreenSettings &&
          mode === 'read' &&
          settingsOpen &&
          readerInteractionReady &&
          session.mayWrite
        }
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
        visible={mode === 'read' && contentsOpen && session.mayWrite}
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
        visible={mode === 'read' && readerSearchOpen && session.mayWrite}
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
        visible={mode === 'listen' && chaptersOpen && session.mayWrite}
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
        visible={mode === 'listen' && sleepTimerOpen && session.mayWrite}
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
      <View
        className={mode === 'read' ? 'min-h-0 flex-1' : 'hidden'}
        pointerEvents={session.mayWrite ? 'auto' : 'none'}
        aria-hidden={!session.mayWrite}
        {...(Platform.OS === 'web' ? { inert: !session.mayWrite } : {})}
      >
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
          paused={Boolean(pausedDevice)}
        />
        {pausedDevice ? (
          // Fades toward the page color, so text recedes the same way in light and dark themes.
          <View pointerEvents="none" className="absolute inset-0 bg-canvas/70" />
        ) : null}
      </View>
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
          pausedNotice={
            pausedDevice ? (
              <PausedElsewhereNotice
                surface="player"
                device={pausedDevice}
                resuming={session.state.kind === 'claiming'}
                onResume={session.resume}
              />
            ) : undefined
          }
          pausedReason={
            !session.mayWrite
              ? pausedDevice
                ? pausedCopy('player', pausedDevice).reason
                : 'Restoring your saved place…'
              : placeConflict
                ? 'Choose a saved place before continuing playback.'
                : undefined
          }
          sleepTimerRemaining={sleepTimerRemaining}
          setSleepTimerOpen={setSleepTimerOpen}
        />
      ) : null}
    </View>
  );
}
