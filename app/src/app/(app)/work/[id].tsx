import type { AlignmentJob, Media, Representation, WorkDetail } from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '../../../features/auth/AuthProvider';
import { AvailabilityIcons, BookCover, coverPresentation } from '../../../features/bookshelf';
import {
  choices,
  defaultPair,
  readyJob,
  synchronizationLabel,
  type MediaChoice,
} from '../../../features/consumption';
import { formatDuration } from '../../../features/format';
import { AppIcon } from '../../../features/icons';
import { fadeIn, listItemEnter } from '../../../features/motion';
import {
  ReadingStatusDialog,
  readingStatusLabel,
  type ReadingStatus,
} from '../../../features/reading-status';
import { Pressable, Text, View } from '../../../features/tw';
import {
  Button,
  colors,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Page,
  resolvePressStateClass,
  StatusBadge,
} from '../../../features/ui';
import { APIError, api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';
import { downloadOfflineWork, offlineWork, removeOfflineWork } from '../../../lib/offline-library';

/** Translates the exact job-matching result from `consumption.ts` into warm, jargon-free copy. Returns nothing when there's no meaningful sync state to explain (a single-format work, or a pairing that was never attempted). */
function syncNote(label: ReturnType<typeof synchronizationLabel>): string | undefined {
  switch (label) {
    case 'Read + Listen available':
      return 'Read and listen — your place is kept in sync between the two.';
    case 'Synchronization processing':
      return 'Preparing synchronized reading and listening for this pair — ready shortly.';
    case 'Read and Listen available separately':
      return 'Reading and listening progress are tracked separately for this pairing.';
    default:
      return undefined;
  }
}

export default function WorkScreen() {
  const narrow = useWindowDimensions().width < 600;
  const {
    id,
    libraryId,
    role = '',
  } = useLocalSearchParams<{ id: string; libraryId: string; role?: string }>();
  const auth = useAuth();
  const [work, setWork] = useState<WorkDetail>();
  const [media, setMedia] = useState<MediaChoice[]>([]);
  const [jobs, setJobs] = useState<AlignmentJob[]>([]);
  const [hasProgress, setHasProgress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offlineUnreachable, setOfflineUnreachable] = useState(false);
  const [epubID, setEPUBID] = useState('');
  const [audioID, setAudioID] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  async function load() {
    if (!id) return;
    try {
      if (!libraryId) throw new Error('Library unavailable.');
      const [nextWork, nextRepresentations, nextJobs, progress, preference] = await Promise.all([
        api.work(id),
        api.representations(id),
        api.alignmentJobs(id),
        api.workProgress(id),
        api.workPreference(id),
      ]);
      const revisions = await loadRevisions(libraryId, nextRepresentations);
      const pair = defaultPair(
        nextJobs,
        choices(nextRepresentations, revisions, ['epub']),
        choices(nextRepresentations, revisions, ['audio', 'audiobook']),
        preference?.alignment_id ?? progress?.alignment_id,
      );
      setWork(nextWork);
      setMedia(revisions);
      setJobs(nextJobs);
      setHasProgress(Boolean(progress));
      setEPUBID((current) =>
        revisions.some((item) => item.id === current) ? current : (pair.epub?.id ?? ''),
      );
      setAudioID((current) =>
        revisions.some((item) => item.id === current) ? current : (pair.audio?.id ?? ''),
      );
      setDownloaded(Boolean(await offlineWork(id)));
    } catch (value) {
      const saved = await offlineWork(id);
      if (saved && (!libraryId || (value instanceof APIError && value.status === 0))) {
        setWork(saved.work);
        setMedia([...saved.epubs, ...saved.audio]);
        setJobs(saved.jobs);
        setHasProgress(Boolean(saved.progress));
        setEPUBID(saved.epub_id);
        setAudioID(saved.audio_id);
        setDownloaded(true);
        setOffline(true);
      } else {
        setOfflineUnreachable(
          Platform.OS !== 'web' && value instanceof APIError && value.status === 0,
        );
        setError(errorMessage(value));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, libraryId]);

  if (loading)
    return (
      <Page title="Work" hideHeader>
        <LoadingState label="Loading this book…" />
      </Page>
    );

  if (!work)
    return (
      <Page title="Work" hideHeader>
        <ErrorState
          title={offlineUnreachable ? 'Not downloaded yet' : "Couldn't load this book"}
          action={<Button label="Go back" kind="secondary" onPress={() => goBackOr('/home')} />}
        >
          {offlineUnreachable
            ? "This book hasn't been downloaded to this device, so it isn't available while you're offline."
            : error || 'Please try again.'}
        </ErrorState>
      </Page>
    );

  const canEdit = !offline && Boolean(auth.user?.admin || role === 'owner' || role === 'editor');
  const epubs = media.filter((item) => item.kind === 'epub');
  const audio = media.filter((item) => item.kind === 'audio' || item.kind === 'audiobook');
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);
  const note = syncNote(synchronizationLabel(jobs, epubID, audioID));

  const primaryMode: 'read' | 'listen' =
    work.last_mode === 'listen' && selectedAudio
      ? 'listen'
      : work.last_mode === 'read' && selectedEPUB
        ? 'read'
        : selectedEPUB
          ? 'read'
          : 'listen';
  const primaryAvailable = primaryMode === 'read' ? Boolean(selectedEPUB) : Boolean(selectedAudio);
  const secondaryMode: 'read' | 'listen' = primaryMode === 'read' ? 'listen' : 'read';
  const secondaryAvailable =
    secondaryMode === 'read' ? Boolean(selectedEPUB) : Boolean(selectedAudio);

  function consume(mode: 'read' | 'listen') {
    router.push(`/consume/${id}?mode=${mode}&epub=${epubID}&audio=${audioID}`);
  }

  async function rememberPair(nextEPUBID: string, nextAudioID: string) {
    if (!id || offline) return;
    const job = readyJob(jobs, nextEPUBID, nextAudioID);
    if (!job?.alignment_id) return;
    try {
      await api.setWorkPreference(id, {
        epub_media_id: nextEPUBID,
        audio_media_id: nextAudioID,
        alignment_id: job.alignment_id,
      });
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function selectEPUB(next: string) {
    setEPUBID(next);
    void rememberPair(next, audioID);
  }

  function selectAudio(next: string) {
    setAudioID(next);
    void rememberPair(epubID, next);
  }

  function openManage() {
    router.push(`/work/${id}/manage?libraryId=${libraryId}&role=${role}`);
  }

  async function changeReadingStatus(status: ReadingStatus) {
    if (!id || !work || statusBusy || offline) return;
    setStatusBusy(true);
    setError('');
    try {
      await api.setWorkStatus(id, { status });
      setWork({ ...work, reading_status: status });
      setStatusOpen(false);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setStatusBusy(false);
    }
  }

  async function toggleOfflineDownload() {
    if (!id || !work || downloadBusy) return;
    setDownloadBusy(true);
    setError('');
    try {
      if (downloaded) {
        await removeOfflineWork(id);
        setDownloaded(false);
        return;
      }
      const selectedJob = readyJob(jobs, epubID, audioID);
      const [alignment, progress, epubState, audioState, audioChapters] = await Promise.all([
        selectedJob?.alignment_id ? api.alignment(selectedJob.alignment_id) : undefined,
        api.workProgress(id),
        selectedEPUB ? api.representationState(selectedEPUB.representation.id) : null,
        selectedAudio ? api.representationState(selectedAudio.representation.id) : null,
        selectedAudio ? api.audioChapters(selectedAudio.id).catch(() => []) : [],
      ]);
      await downloadOfflineWork({
        work,
        epubs: selectedEPUB ? [selectedEPUB] : [],
        audio: selectedAudio ? [selectedAudio] : [],
        jobs: selectedJob ? [selectedJob] : [],
        epub_id: selectedEPUB?.id ?? '',
        audio_id: selectedAudio?.id ?? '',
        alignment,
        progress,
        epub_state: epubState,
        audio_state: audioState,
        audio_chapters: selectedAudio ? { [selectedAudio.id]: audioChapters } : {},
      });
      setDownloaded(true);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setDownloadBusy(false);
    }
  }

  return (
    <Page title="Work" hideHeader>
      <View className="flex-row items-center justify-between">
        <Button
          label="Library"
          icon="back"
          kind="quiet"
          onPress={() => goBackOr(`/library/${libraryId}`)}
        />
        {canEdit ? (
          narrow ? (
            <IconButton
              icon="settings"
              label="Manage this work"
              kind="quiet"
              onPress={openManage}
            />
          ) : (
            <Button label="Manage this work" icon="settings" kind="quiet" onPress={openManage} />
          )
        ) : null}
      </View>

      {offline ? (
        <Notice tone="info">
          You&apos;re offline — showing what&apos;s downloaded on this device.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Animated.View entering={fadeIn}>
        <View className="flex-row items-start gap-4 sm:gap-8">
          <BookCover
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            size={narrow ? 'small' : 'hero'}
            {...coverPresentation(work)}
          />
          <View className="min-w-0 flex-1 items-start gap-3">
            <Text
              numberOfLines={3}
              className={`${narrow ? 'text-2xl leading-7' : 'text-4xl leading-[44px]'} font-editorial font-extrabold text-ink`}
            >
              {work.title}
            </Text>
            <Text numberOfLines={2} className="text-base text-muted sm:text-lg">
              {work.author || 'Unknown author'}
            </Text>

            <View className="flex-row flex-wrap items-center gap-3">
              <AvailabilityIcons
                value={{
                  readable: Boolean(selectedEPUB),
                  listenable: Boolean(selectedAudio),
                  synchronized: Boolean(readyJob(jobs, epubID, audioID)),
                }}
              />
              <ReadingStatusTrigger
                status={work.reading_status}
                disabled={offline}
                onPress={() => setStatusOpen(true)}
              />
            </View>

            {work.in_progress ? (
              <View className="w-full max-w-md gap-1.5 py-0.5">
                <View
                  className="h-1.5 overflow-hidden rounded-full bg-line"
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: work.completion_percent }}
                >
                  <View
                    className="h-full rounded-full bg-accent-strong"
                    style={{ width: `${work.completion_percent}%` }}
                  />
                </View>
                <Text className="text-sm text-muted">
                  {work.completion_percent}% complete
                  {work.active_seconds > 0
                    ? ` · ${formatDuration(work.active_seconds)} active`
                    : ''}
                </Text>
              </View>
            ) : null}

            {primaryAvailable ? (
              <View className="flex-row flex-wrap items-center gap-2 pt-1">
                <Button
                  label={
                    narrow
                      ? hasProgress
                        ? 'Continue'
                        : primaryMode === 'read'
                          ? 'Read'
                          : 'Listen'
                      : `${hasProgress ? 'Continue' : 'Start'} ${primaryMode === 'read' ? 'reading' : 'listening'}`
                  }
                  icon={primaryMode === 'read' ? 'read' : 'listen'}
                  kind="primary"
                  onPress={() => consume(primaryMode)}
                />
                {secondaryAvailable ? (
                  <IconButton
                    icon={secondaryMode === 'read' ? 'read' : 'listen'}
                    label={secondaryMode === 'read' ? 'Read this book' : 'Listen to this book'}
                    kind="quiet"
                    onPress={() => consume(secondaryMode)}
                  />
                ) : null}
              </View>
            ) : (
              <Notice tone="info">This book isn&apos;t available to read or listen to yet.</Notice>
            )}

            {note ? <Text className="max-w-md text-sm text-muted">{note}</Text> : null}

            {Platform.OS !== 'web' && (selectedEPUB || selectedAudio) ? (
              <View className="flex-row flex-wrap items-center gap-2 pt-1">
                <Button
                  label={downloaded ? 'Remove download' : 'Download for offline'}
                  icon={downloaded ? 'delete' : 'acquire'}
                  kind="quiet"
                  loading={downloadBusy}
                  disabled={downloadBusy || offline}
                  onPress={() => void toggleOfflineDownload()}
                />
                {downloaded ? (
                  <StatusBadge tone="success" icon="check" label="On this device" />
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </Animated.View>

      <EditionSection
        epubs={epubs}
        audio={audio}
        epubID={epubID}
        audioID={audioID}
        onSelectEPUB={selectEPUB}
        onSelectAudio={selectAudio}
      />

      <ReadingStatusDialog
        work={work}
        visible={statusOpen}
        busy={statusBusy}
        onChange={(status) => void changeReadingStatus(status)}
        onClose={() => setStatusOpen(false)}
      />
    </Page>
  );
}

/** Compact reading-status trigger — kept out of the primary action row so "Continue" never has to compete with it for attention. */
function ReadingStatusTrigger({
  status,
  disabled,
  onPress,
}: {
  status: ReadingStatus;
  disabled: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const icon = status === 'finished' ? 'check' : status === 'reading' ? 'read' : 'add';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Reading status: ${readingStatusLabel(status)}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-1.5 rounded-control border border-line px-3 ${disabled ? 'opacity-50' : ''} ${stateClass}`}
    >
      <AppIcon name={icon} size={15} color={colors.muted} />
      <Text className="text-xs font-bold uppercase tracking-wide text-muted">
        {readingStatusLabel(status)}
      </Text>
      <AppIcon name="chevron" size={15} color={colors.subtle} />
    </Pressable>
  );
}

/** Edition/narration picker — renders nothing unless a group genuinely has more than one option, per "only when choices actually exist." */
function EditionSection({
  epubs,
  audio,
  epubID,
  audioID,
  onSelectEPUB,
  onSelectAudio,
}: {
  epubs: MediaChoice[];
  audio: MediaChoice[];
  epubID: string;
  audioID: string;
  onSelectEPUB: (id: string) => void;
  onSelectAudio: (id: string) => void;
}) {
  if (epubs.length <= 1 && audio.length <= 1) return null;

  return (
    <View className="gap-6 border-t border-line pt-6 sm:flex-row sm:gap-12">
      {epubs.length > 1 ? (
        <EditionGroup
          label="Reading edition"
          icon="read"
          items={epubs}
          selected={epubID}
          onSelect={onSelectEPUB}
        />
      ) : null}
      {audio.length > 1 ? (
        <EditionGroup
          label="Narration"
          icon="listen"
          items={audio}
          selected={audioID}
          onSelect={onSelectAudio}
        />
      ) : null}
    </View>
  );
}

function EditionGroup({
  label,
  icon,
  items,
  selected,
  onSelect,
}: {
  label: string;
  icon: 'read' | 'listen';
  items: MediaChoice[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View className="min-w-[240px] flex-1 gap-1">
      <View className="flex-row items-center gap-1.5 pb-1">
        <AppIcon name={icon} size={15} color={colors.subtle} />
        <Text className="text-xs font-bold uppercase tracking-wide text-subtle">{label}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={label}>
        {items.map((item, index) => (
          <Animated.View key={item.id} entering={listItemEnter(index)}>
            <EditionOption
              label={item.representation.label}
              detail={formatBytes(item.size_bytes)}
              selected={selected === item.id}
              onPress={() => onSelect(item.id)}
            />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

function EditionOption({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const ringClass = selected ? 'border-accent' : 'border-line';

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-3 rounded-control py-2 ${stateClass}`}
    >
      <View
        className={`h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-paper ${ringClass}`}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-semibold text-ink">
          {label}
        </Text>
        <Text className="text-xs text-subtle">{detail}</Text>
      </View>
    </Pressable>
  );
}

async function loadRevisions(libraryId: string, representations: Representation[]) {
  const grouped = await Promise.all(
    representations.map(async (representation) =>
      (await api.media(libraryId, representation.id)).map((item: Media) => ({
        ...item,
        representation,
      })),
    ),
  );
  return grouped.flat();
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
