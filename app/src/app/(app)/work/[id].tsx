import type {
  AlignmentJob,
  Collection,
  Library,
  Media,
  Representation,
  WorkDetail,
} from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '../../../features/auth/AuthProvider';
import {
  AvailabilityIcons,
  Badge,
  BookCover,
  coverPresentation,
} from '../../../features/bookshelf';
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
  Checkbox,
  colors,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Page,
  resolvePressStateClass,
} from '../../../features/ui';
import { APIError, api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';
import { downloadOfflineWork, offlineWork, removeOfflineWork } from '../../../lib/offline-library';

/** Open Library reports language as an ISO 639-2 code (e.g. "eng"); shown to readers as a name. */
const languageNames: Record<string, string> = {
  eng: 'English',
  fre: 'French',
  fra: 'French',
  ger: 'German',
  deu: 'German',
  spa: 'Spanish',
  ita: 'Italian',
  por: 'Portuguese',
  rus: 'Russian',
  jpn: 'Japanese',
  chi: 'Chinese',
  zho: 'Chinese',
  ara: 'Arabic',
  lat: 'Latin',
  gre: 'Greek',
  grc: 'Ancient Greek',
  dut: 'Dutch',
  nld: 'Dutch',
  swe: 'Swedish',
  pol: 'Polish',
  kor: 'Korean',
};
function languageName(code: string) {
  return languageNames[code.toLowerCase()] || code.toUpperCase();
}

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const [work, setWork] = useState<WorkDetail>();
  const [library, setLibrary] = useState<Library>();
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
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [initialCollectionIDs, setInitialCollectionIDs] = useState<string[]>([]);
  const [selectedCollectionIDs, setSelectedCollectionIDs] = useState<string[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [collectionError, setCollectionError] = useState('');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const nextWork = await api.work(id);
      const [nextLibrary, nextRepresentations, nextJobs, progress, preference] = await Promise.all([
        api.library(nextWork.library_id),
        api.representations(id),
        api.alignmentJobs(id),
        api.workProgress(id),
        api.workPreference(id),
      ]);
      const revisions = await loadRevisions(nextWork.library_id, nextRepresentations);
      const pair = defaultPair(
        nextJobs,
        choices(nextRepresentations, revisions, ['epub']),
        choices(nextRepresentations, revisions, ['audio', 'audiobook']),
        preference?.alignment_id ?? progress?.alignment_id,
      );
      setWork(nextWork);
      setLibrary(nextLibrary);
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
      if (saved && value instanceof APIError && value.status === 0) {
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
  }, [id]);

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

  const canEdit =
    !offline &&
    Boolean(auth.user?.admin || library?.role === 'owner' || library?.role === 'editor');
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
  const description = work.description?.trim();
  const details = [
    work.first_publish_year ? `First published ${work.first_publish_year}` : '',
    work.publisher ? work.publisher : '',
    work.language ? languageName(work.language) : '',
    work.isbn ? `ISBN ${work.isbn}` : '',
  ].filter(Boolean);
  const subjects = (work.subjects || '')
    .split(',')
    .map((subject) => subject.trim())
    .filter(Boolean);
  const formatLabel = selectedEPUB
    ? selectedAudio
      ? 'Ebook and audiobook'
      : 'Ebook'
    : selectedAudio
      ? 'Audiobook'
      : 'Unavailable';

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
    router.push(`/work/${id}/manage`);
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

  async function openCollections() {
    if (!id || offline) return;
    setCollectionOpen(true);
    setCollectionLoading(true);
    setCollectionError('');
    try {
      const summaries = await api.collections();
      const details = await Promise.all(
        summaries.map((collection) => api.collection(collection.id)),
      );
      const selected = details
        .filter((collection) => collection.works?.some((item) => item.id === id))
        .map((collection) => collection.id);
      setCollections(details);
      setInitialCollectionIDs(selected);
      setSelectedCollectionIDs(selected);
    } catch (value) {
      setCollectionError(errorMessage(value));
    } finally {
      setCollectionLoading(false);
    }
  }

  function toggleCollection(collectionID: string) {
    setSelectedCollectionIDs((current) =>
      current.includes(collectionID)
        ? current.filter((value) => value !== collectionID)
        : [...current, collectionID],
    );
  }

  async function saveCollections() {
    if (!id) return;
    setCollectionBusy(true);
    setCollectionError('');
    const initial = new Set(initialCollectionIDs);
    const selected = new Set(selectedCollectionIDs);
    try {
      await Promise.all([
        ...selectedCollectionIDs
          .filter((collectionID) => !initial.has(collectionID))
          .map((collectionID) => api.addCollectionWork(collectionID, id)),
        ...initialCollectionIDs
          .filter((collectionID) => !selected.has(collectionID))
          .map((collectionID) => api.removeCollectionWork(collectionID, id)),
      ]);
      setInitialCollectionIDs(selectedCollectionIDs);
      setCollectionOpen(false);
    } catch (value) {
      setCollectionError(errorMessage(value));
    } finally {
      setCollectionBusy(false);
    }
  }

  return (
    <Page title="Work" hideHeader>
      <View className="flex-row items-center justify-between">
        <Button
          label="Library"
          icon="back"
          kind="quiet"
          onPress={() => goBackOr(`/library/${work.library_id}`)}
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
        <View
          className={
            narrow
              ? 'items-center gap-6 py-4'
              : 'mx-auto w-full max-w-[1000px] flex-row items-start gap-12 py-10'
          }
        >
          <BookCover
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            size={narrow ? 'small' : 'hero'}
            {...coverPresentation(work)}
          />
          <View
            className={
              narrow ? 'w-full items-center gap-4' : 'min-w-0 flex-1 items-start gap-4 pt-2'
            }
          >
            <Text
              className={`text-xs font-sans-bold uppercase tracking-wide text-accent ${narrow ? 'text-center' : ''}`}
            >
              {formatLabel}
            </Text>
            <Text
              numberOfLines={3}
              className={`${narrow ? 'text-center text-3xl leading-9' : 'text-4xl leading-[44px]'} font-editorial-bold text-ink`}
            >
              {work.title}
            </Text>
            <Text
              numberOfLines={2}
              className={`text-base text-muted sm:text-lg ${narrow ? 'text-center' : ''}`}
            >
              {work.author || 'Unknown author'}
            </Text>

            {selectedEPUB || selectedAudio ? (
              <View
                className={`flex-row flex-wrap items-center gap-3 ${narrow ? 'justify-center' : ''}`}
              >
                <AvailabilityIcons
                  value={{
                    readable: Boolean(selectedEPUB),
                    listenable: Boolean(selectedAudio),
                    synchronized: Boolean(readyJob(jobs, epubID, audioID)),
                  }}
                />
              </View>
            ) : null}

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
                <Text className={`text-sm text-muted ${narrow ? 'text-center' : ''}`}>
                  {work.completion_percent}% complete
                  {work.active_seconds > 0
                    ? ` · ${formatDuration(work.active_seconds)} active`
                    : ''}
                </Text>
              </View>
            ) : null}

            {primaryAvailable ? (
              <View
                className={`flex-row flex-wrap items-center gap-2 pt-1 ${narrow ? 'justify-center' : ''}`}
              >
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
                  <Button
                    icon={secondaryMode === 'read' ? 'read' : 'listen'}
                    label={secondaryMode === 'read' ? 'Read instead' : 'Listen instead'}
                    kind="secondary"
                    onPress={() => consume(secondaryMode)}
                  />
                ) : null}
              </View>
            ) : (
              <Notice tone="info">This book isn&apos;t available to read or listen to yet.</Notice>
            )}

            {note ? (
              <Text className={`max-w-md text-sm text-muted ${narrow ? 'text-center' : ''}`}>
                {note}
              </Text>
            ) : null}

            <View
              className={`w-full flex-row flex-wrap items-center gap-2 border-t border-line pt-4 ${narrow ? 'justify-center' : ''}`}
            >
              <Button
                label={readingStatusLabel(work.reading_status)}
                icon={
                  work.reading_status === 'finished'
                    ? 'check'
                    : work.reading_status === 'reading'
                      ? 'read'
                      : 'add'
                }
                kind="quiet"
                disabled={offline}
                onPress={() => setStatusOpen(true)}
              />
              <Button
                label="Add to collection"
                icon="collections"
                kind="quiet"
                disabled={offline}
                onPress={() => void openCollections()}
              />
              {Platform.OS !== 'web' && (selectedEPUB || selectedAudio) ? (
                downloadBusy ? (
                  <View className="h-11 w-11 items-center justify-center">
                    <ActivityIndicator color={colors.accent} />
                  </View>
                ) : (
                  <IconButton
                    icon={downloaded ? 'enabled' : 'acquire'}
                    label={downloaded ? 'Remove download (on this device)' : 'Download for offline'}
                    kind="quiet"
                    disabled={offline}
                    onPress={() => void toggleOfflineDownload()}
                  />
                )
              ) : null}
            </View>
          </View>
        </View>
      </Animated.View>

      {description || details.length || canEdit ? (
        <View className="mx-auto w-full max-w-[1000px] gap-3 border-t border-line py-6 sm:py-8">
          <Text className="font-editorial-bold text-2xl text-ink">About this book</Text>
          {description ? (
            <>
              <Text
                numberOfLines={descriptionExpanded ? undefined : 5}
                className="max-w-[70ch] text-base leading-7 text-muted"
              >
                {description}
              </Text>
              {description.length > 360 ? (
                <Button
                  label={descriptionExpanded ? 'Show less' : 'Show more'}
                  kind="quiet"
                  onPress={() => setDescriptionExpanded((current) => !current)}
                />
              ) : null}
            </>
          ) : canEdit ? (
            <View className="gap-2">
              <Text className="max-w-[70ch] text-base text-muted">
                No description yet — Aldus can pull a description, publisher, language, and subjects
                from Open Library, or you can write your own from Manage this work.
              </Text>
              <View className="self-start">
                <Button
                  label="Fill in details from Open Library"
                  icon="scan"
                  kind="secondary"
                  onPress={() => router.push(`/work/${id}/manage?tab=cover`)}
                />
              </View>
            </View>
          ) : null}
          {details.length ? (
            <Text className="text-sm text-subtle">{details.join(' · ')}</Text>
          ) : null}
          {subjects.length ? (
            <View className="flex-row flex-wrap gap-1.5 pt-1">
              {subjects.map((subject) => (
                <Badge key={subject}>{subject}</Badge>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="mx-auto w-full max-w-[1000px]">
        <EditionSection
          epubs={epubs}
          audio={audio}
          epubID={epubID}
          audioID={audioID}
          onSelectEPUB={selectEPUB}
          onSelectAudio={selectAudio}
        />
      </View>

      <ReadingStatusDialog
        work={work}
        visible={statusOpen}
        busy={statusBusy}
        onChange={(status) => void changeReadingStatus(status)}
        onClose={() => setStatusOpen(false)}
      />
      <Dialog
        visible={collectionOpen}
        title="Add to collection"
        onClose={() => setCollectionOpen(false)}
      >
        <View className="gap-4">
          {collectionError ? <Notice tone="danger">{collectionError}</Notice> : null}
          {collectionLoading ? (
            <LoadingState label="Loading collections…" />
          ) : collections.length ? (
            <View className="gap-1">
              {collections.map((collection) => (
                <Checkbox
                  key={collection.id}
                  label={collection.title}
                  checked={selectedCollectionIDs.includes(collection.id)}
                  onPress={() => toggleCollection(collection.id)}
                />
              ))}
              <Button
                label="Save collections"
                kind="primary"
                loading={collectionBusy}
                onPress={() => void saveCollections()}
              />
            </View>
          ) : !collectionError ? (
            <EmptyState
              icon="collections"
              title="No collections yet"
              action={
                <Button
                  label="Create a collection"
                  kind="primary"
                  onPress={() => {
                    setCollectionOpen(false);
                    router.push('/collections');
                  }}
                />
              }
            >
              Create a collection, then return here to add this book.
            </EmptyState>
          ) : null}
        </View>
      </Dialog>
    </Page>
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
        <Text className="text-xs font-sans-bold uppercase tracking-wide text-subtle">{label}</Text>
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
        <Text numberOfLines={1} className="text-sm font-sans-semibold text-ink">
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
