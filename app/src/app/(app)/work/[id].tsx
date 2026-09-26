import { loadWorkDetail } from '@/lib/catalog/load-work-detail';
import { fallbackCoverURL } from '@/lib/catalog/cover-artwork';
import { EditionSection } from '@/components/catalog/EditionSection';
import {
  DetailFacts,
  DetailSection,
  DetailTabs,
  ProgressMeter,
  SyncNote,
  type DetailFact,
  type DetailTabKey,
} from '@/components/catalog/work-detail';
import {
  AlignmentProgress,
  alignmentRunning,
  useAlignmentPolling,
} from '@/components/catalog/alignment-progress';
import { RequestActions } from '@/components/acquisitions/request-actions';
import type { AlignmentJob, Collection, Library, ReadingOwner, WorkDetail } from '@/generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '@/components/auth/AuthProvider';
import { BookCover, coverPresentation } from '@/components/catalog/bookshelf';
import {
  choices,
  defaultPair,
  readyJob,
  synchronizationLabel,
  workProgressLabel,
  type MediaChoice,
} from '@/lib/consumption/consumption';
import { formatDuration } from '@/lib/format';
import { getDeviceIdentity } from '@/lib/device-identity';
import { activeElsewhereHint } from '@/lib/consumption/handoff-copy';
import { PROMPT_WINDOW_SECONDS } from '@/lib/consumption/reading-session';
import { fadeIn, layoutShift } from '@/components/ui/motion';
import {
  ReadingStatusDialog,
  readingStatusLabel,
  type ReadingStatus,
} from '@/components/catalog/reading-status';
import { AnimatedView, Text, View } from '@/components/ui/tw';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  StatusBadge,
} from '@/components/ui';
import { GenreTagChip } from '@/components/catalog/GenreTagChip';
import { Page } from '@/components/shell/Page';
import { APIError, api, errorMessage } from '@/lib/api';
import { DownloadFormatDialog } from '@/components/catalog/download-format-dialog';
import { DownloadStatus } from '@/components/catalog/download-status';
import { activeStorageScope } from '@/lib/storage-scope';
import { DownloadInterrupted } from '@/lib/download-interrupted';
import { listDownloads, subscribeDownloads } from '@/lib/native-download';
import { getAPIBaseURL } from '@/lib/api-base';
import { goBackOr } from '@/lib/navigation';
import { downloadOfflineWork, offlineWork } from '@/lib/offline-library';

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
  const { width } = useWindowDimensions();
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
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
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadError, setDownloadError] = useState('');
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
  const [descriptionToggled, setDescriptionToggled] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTabKey>('about');
  const [activeElsewhere, setActiveElsewhere] = useState<ReadingOwner | null>(null);

  const progressUnreachable = useAlignmentPolling(
    id || '',
    !offline && jobs.some(alignmentRunning),
    setJobs,
  );

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!id) return;
      try {
        const {
          nextWork,
          nextLibrary,
          nextRepresentations,
          nextJobs,
          progress,
          preference,
          revisions,
        } = await loadWorkDetail(id);
        const downloaded = Boolean(await offlineWork(id));
        if (canceled) return;
        const pair = defaultPair(
          nextJobs,
          choices(nextRepresentations, revisions, ['epub']),
          choices(nextRepresentations, revisions, ['audio', 'audiobook']),
          preference?.alignment_id ?? progress?.alignment_id,
        );
        setError('');
        setOffline(false);
        setOfflineUnreachable(false);
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
        setDownloaded(downloaded);
      } catch (value) {
        const saved = await offlineWork(id);
        if (canceled) return;
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
        if (!canceled) setLoading(false);
      }
    }

    setLoading(true);
    void load();
    return () => {
      canceled = true;
    };
  }, [id]);

  // Read-only: viewing details never claims the book or interrupts the device reading it.
  useEffect(() => {
    if (!id || offline) return;
    let canceled = false;
    Promise.all([api.readingSession(id), getDeviceIdentity()])
      .then(([owner, identity]) => {
        if (canceled) return;
        const elsewhere =
          owner &&
          owner.device_id !== identity.deviceID &&
          owner.idle_seconds <= PROMPT_WINDOW_SECONDS;
        setActiveElsewhere(elsewhere ? owner : null);
      })
      .catch(() => {
        if (!canceled) setActiveElsewhere(null);
      });
    return () => {
      canceled = true;
    };
  }, [id, offline]);

  useEffect(() => {
    if (!id || Platform.OS === 'web') return;
    let disposed = false;
    let revision = 0;
    const unsubscribe = subscribeDownloads(() => {
      const request = ++revision;
      const scope = activeStorageScope();
      void offlineWork(id)
        .then((value) => {
          if (!disposed && request === revision && scope === activeStorageScope())
            setDownloaded(Boolean(value));
        })
        .catch(() => {});
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [id]);

  useEffect(() => {
    if (loading || !work || !action) return;
    router.setParams({ action: undefined });
    if (offline) {
      setError('Connect to your server to change collections, status, or download more files.');
      return;
    }
    if (action === 'downloads' && Platform.OS !== 'web') setDownloadOpen(true);
    if (action === 'status') setStatusOpen(true);
    if (action === 'collection') void openCollections();
    // Consume the requested action once after this book is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, loading, work, offline]);

  if (loading)
    return (
      <Page title="Book details" hideHeader>
        <LoadingState layout="work" label="Loading this book…" />
      </Page>
    );

  if (!work)
    return (
      <Page title="Book details" hideHeader>
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
  const activeAlignment = jobs.find(
    (job) =>
      job.epub_media_id === epubID && job.audio_media_id === audioID && alignmentRunning(job),
  );
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
  const genreTags = work.genre_tags ?? [];
  const narrators = selectedAudio?.representation.narrators ?? [];
  const nextInSeries = work.next_in_series;
  const facts: DetailFact[] = [
    work.first_publish_year
      ? { label: 'First published', value: String(work.first_publish_year) }
      : null,
    work.publisher ? { label: 'Publisher', value: work.publisher } : null,
    work.language ? { label: 'Language', value: languageName(work.language) } : null,
    work.isbn ? { label: 'ISBN', value: work.isbn } : null,
    ...narrators.map((name): DetailFact => ({
      label: 'Narrated by',
      value: name,
      onPress: () => router.push({ pathname: '/catalog', params: { narrator: name } }),
    })),
    nextInSeries
      ? {
          label: 'Next in series',
          value: nextInSeries.title,
          onPress: () => router.push(`/work/${nextInSeries.id}`),
        }
      : null,
  ].filter((fact): fact is DetailFact => fact !== null);
  // The desktop rail takes 224px; the split layout needs about 900px of what remains.
  const contentWidth = width - (width >= 820 ? 224 : 0);
  const split = contentWidth >= 900;
  const phone = width < 600;
  const coverRatio = selectedAudio && !selectedEPUB ? 1 : 0.68;
  const statusLabel = readingStatusLabel(work.reading_status);
  const statusIcon =
    work.reading_status === 'finished'
      ? 'check'
      : work.reading_status === 'reading'
        ? 'read'
        : 'add';
  const downloadAvailable = Platform.OS !== 'web' && Boolean(selectedEPUB || selectedAudio);
  const editionChoices = epubs.length > 1 || audio.length > 1;
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

  async function startOfflineDownload(format: 'epub' | 'audio' | 'both') {
    if (!id || !work || downloadBusy) return;
    const scope = activeStorageScope();
    const origin = getAPIBaseURL();
    setDownloadOpen(false);
    setDownloadBusy(true);
    setDownloadError('');
    setError('');
    let transferStarted = false;
    try {
      const selectedJob = readyJob(jobs, epubID, audioID);
      const [alignment, progress, epubState, audioState, audioChapters] = await Promise.all([
        selectedJob?.alignment_id ? api.alignment(selectedJob.alignment_id) : undefined,
        api.workProgress(id),
        selectedEPUB ? api.representationState(selectedEPUB.representation.id) : null,
        selectedAudio ? api.representationState(selectedAudio.representation.id) : null,
        selectedAudio ? api.audioChapters(selectedAudio.id).catch(() => []) : [],
      ]);
      if (scope !== activeStorageScope() || origin !== getAPIBaseURL())
        throw new Error('The account changed. Retry.');
      transferStarted = true;
      await downloadOfflineWork({
        work,
        epubs: selectedEPUB && format !== 'audio' ? [selectedEPUB] : [],
        audio: selectedAudio && format !== 'epub' ? [selectedAudio] : [],
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
      if (!(value instanceof DownloadInterrupted) && scope === activeStorageScope()) {
        const latest = transferStarted ? await listDownloads().catch(() => []) : [];
        const alreadyReported =
          value instanceof Error &&
          latest.some(
            (item) =>
              (item.id === selectedEPUB?.id || item.id === selectedAudio?.id) &&
              item.status === 'failed' &&
              item.error === value.message,
          );
        if (!alreadyReported)
          setDownloadError(
            value instanceof Error && !(value instanceof APIError)
              ? value.message
              : errorMessage(value),
          );
      }
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

  // One cover represents the book here, full stop — the two-format data
  // model belongs to Manage → Artwork (where each cover has its own
  // controls), not to a "here are our two image fields" display on the
  // book's own page. Ebook art wins when both exist since it reads
  // naturally at book proportions; audio-only books get the square
  // treatment that matches Continue listening elsewhere in the app.
  const coverURL =
    (selectedEPUB ? work.ebook_cover_url : work.audiobook_cover_url) ||
    (selectedEPUB || selectedAudio
      ? `/api/media/${(selectedEPUB || selectedAudio)!.id}/cover`
      : work.cover_url);
  const cover = (
    <View className={split ? 'w-[340px]' : phone ? 'w-[148px]' : 'w-[204px]'}>
      <BookCover
        title={work.title}
        author={work.author}
        coverURL={coverURL}
        fallbackCoverURL={fallbackCoverURL(work, selectedEPUB ? 'ebook' : 'audiobook')}
        size={split ? 'grid' : selectedAudio && !selectedEPUB ? 'audio' : phone ? 'small' : 'hero'}
        aspectRatio={split ? coverRatio : undefined}
        {...coverPresentation(work)}
        coverFit="cover"
      />
    </View>
  );
  const seriesLabel = work.series
    ? `${work.series}${work.series_position ? ` · Book ${work.series_position}` : ''}`
    : '';
  const identity = (
    <View className={split ? 'gap-3' : 'w-full items-center gap-2'}>
      <Text className="text-xs font-sans-medium text-muted">{formatLabel}</Text>
      <Text
        accessibilityRole="header"
        numberOfLines={3}
        // Lora's own line metrics are far taller than its size on iOS, so the phone title pins its line height.
        style={split ? undefined : { lineHeight: 32 }}
        className={`${split ? 'text-[52px] leading-[58px]' : 'text-center text-[26px]'} font-editorial text-ink`}
      >
        {work.title}
      </Text>
      <Text
        numberOfLines={2}
        className={`${split ? 'text-xl' : 'text-center text-base'} text-muted`}
      >
        {work.author || 'Unknown author'}
      </Text>
      {work.series ? (
        <Button
          kind="quiet"
          label={seriesLabel}
          icon="collections"
          onPress={() =>
            router.push({
              pathname: '/catalog',
              params: { series: work.series, library_id: work.library_id },
            })
          }
        />
      ) : null}
      {activeElsewhere && !offline ? (
        <StatusBadge
          tone="info"
          icon={activeElsewhere.platform === 'web' ? 'monitor' : 'phone'}
          label={activeElsewhereHint(
            { label: activeElsewhere.label, platform: activeElsewhere.platform },
            activeElsewhere.idle_seconds,
          )}
        />
      ) : null}
    </View>
  );
  const genreChips = genreTags.length ? (
    <View className={`flex-row flex-wrap gap-1.5 ${split ? '' : 'justify-center'}`}>
      {genreTags.map((tag) => (
        <GenreTagChip key={tag.id} icon={tag.icon} label={tag.label} />
      ))}
    </View>
  ) : null;

  const primaryButton = primaryAvailable ? (
    <Button
      label={`${hasProgress || work.in_progress ? 'Continue' : 'Start'} ${primaryMode === 'read' ? 'reading' : 'listening'}`}
      icon={primaryMode === 'read' ? 'read' : 'listen'}
      kind="primary"
      onPress={() => consume(primaryMode)}
    />
  ) : null;
  const secondaryButton =
    primaryAvailable && secondaryAvailable ? (
      <Button
        icon={secondaryMode === 'read' ? 'read' : 'listen'}
        label={secondaryMode === 'read' ? 'Read' : 'Listen'}
        kind="secondary"
        onPress={() => consume(secondaryMode)}
      />
    ) : null;
  const unavailableNotice = primaryAvailable ? null : (
    <Notice tone="info">This book isn&apos;t available to read or listen to yet.</Notice>
  );
  const progressMeter = work.in_progress ? (
    <ProgressMeter
      percent={work.completion_percent}
      label={`${workProgressLabel(work.in_progress, work.completion_percent)}${work.active_seconds > 0 ? ` · ${formatDuration(work.active_seconds)} active` : ''}`}
    />
  ) : null;
  const syncBlock = activeAlignment ? (
    <View className="gap-3 rounded-card border border-line-subtle bg-paper p-4">
      <AlignmentProgress job={activeAlignment} unreachable={progressUnreachable} compact />
      {canEdit ? (
        <View className="self-start">
          <Button
            label="View sync details"
            kind="quiet"
            onPress={() => router.push(`/work/${id}/manage?tab=sync`)}
          />
        </View>
      ) : null}
    </View>
  ) : note ? (
    <SyncNote text={note} />
  ) : null;
  const downloadStatus =
    Platform.OS !== 'web' ? (
      <DownloadStatus compact mediaIDs={media.map((item) => item.id)} error={downloadError} />
    ) : null;

  const descriptionBody = description ? (
    <AnimatedView layout={descriptionToggled ? layoutShift : undefined} className="gap-1">
      <Text
        numberOfLines={descriptionExpanded ? undefined : split ? 6 : 5}
        className="max-w-[64ch] text-base leading-7 text-muted"
      >
        {description}
      </Text>
      {description.length > 360 ? (
        <View className="-ml-2 self-start">
          <Button
            label={descriptionExpanded ? 'Show less' : 'Show more'}
            kind="quiet"
            onPress={() => {
              setDescriptionToggled(true);
              setDescriptionExpanded((current) => !current);
            }}
          />
        </View>
      ) : null}
    </AnimatedView>
  ) : canEdit ? (
    <View className="gap-2">
      <Text className="max-w-[64ch] text-base text-muted">
        Add a description and book details from Open Library, or edit them in Manage this work.
      </Text>
      <View className="self-start">
        <Button
          label="Fill in details from Open Library"
          icon="scan"
          kind="secondary"
          onPress={() => router.push(`/work/${id}/manage?tab=artwork`)}
        />
      </View>
    </View>
  ) : null;
  const factsBody = facts.length ? <DetailFacts facts={facts} /> : null;
  const editionsBody = editionChoices ? (
    <EditionSection
      epubs={epubs}
      audio={audio}
      epubID={epubID}
      audioID={audioID}
      onSelectEPUB={selectEPUB}
      onSelectAudio={selectAudio}
    />
  ) : null;
  const requestBody =
    !offline && (!selectedEPUB || !selectedAudio) ? (
      <RequestActions
        key={work.id}
        book={{
          ...work,
          work_id: work.id,
          readable: Boolean(selectedEPUB),
          listenable: Boolean(selectedAudio),
          synchronized: false,
        }}
      />
    ) : null;

  const statusButton = (
    <Button
      label={statusLabel}
      icon={statusIcon}
      kind="secondary"
      disabled={offline}
      onPress={() => setStatusOpen(true)}
    />
  );
  const collectionButton = (
    <Button
      label="Collection"
      accessibilityLabel="Add to collection"
      icon="collections"
      kind="secondary"
      disabled={offline}
      onPress={() => void openCollections()}
    />
  );
  const downloadButton = downloadAvailable ? (
    <Button
      label={downloaded ? 'Downloads' : 'Download'}
      accessibilityLabel={downloaded ? 'Manage offline downloads' : 'Download for offline'}
      icon={downloaded ? 'enabled' : 'acquire'}
      kind="secondary"
      loading={downloadBusy}
      disabled={offline}
      onPress={() => setDownloadOpen(true)}
    />
  ) : null;

  const tabs = [
    { key: 'about' as const, label: 'About', visible: true },
    { key: 'details' as const, label: 'Details', visible: Boolean(factsBody) },
    { key: 'editions' as const, label: 'Editions', visible: Boolean(editionsBody) },
  ].filter((tab) => tab.visible);
  const activeTab = tabs.some((tab) => tab.key === detailTab) ? detailTab : 'about';

  const splitLayout = (
    <View className="mx-auto w-full max-w-[1080px] flex-row items-start gap-14 pb-10 pt-2">
      <View
        className="w-[340px] shrink-0 gap-4"
        style={Platform.OS === 'web' ? ({ position: 'sticky', top: 24 } as object) : undefined}
      >
        {cover}
        {unavailableNotice}
        {primaryButton}
        {secondaryButton}
        {progressMeter}
        {syncBlock}
        {downloadStatus}
      </View>
      <View className="min-w-0 flex-1 gap-8 pt-1">
        <View className="gap-5">
          {identity}
          {genreChips}
          <View className="flex-row flex-wrap gap-2">
            {statusButton}
            {collectionButton}
            {downloadButton}
          </View>
        </View>
        <DetailSection index={1} title="About this book">
          {descriptionBody}
        </DetailSection>
        {editionsBody ? (
          <DetailSection index={2} title="Editions">
            {editionsBody}
          </DetailSection>
        ) : null}
        {factsBody ? (
          <DetailSection index={3} title="Details">
            <View className="max-w-lg">{factsBody}</View>
          </DetailSection>
        ) : null}
        {requestBody ? (
          <DetailSection index={4} title="Get another format">
            {requestBody}
          </DetailSection>
        ) : null}
      </View>
    </View>
  );

  const showcaseLayout = (
    <View className="mx-auto w-full max-w-[720px] gap-6 pb-10">
      <View
        className={`items-center rounded-dialog bg-accent-soft/50 ${phone ? 'gap-3 px-4 pb-5 pt-5' : 'gap-4 px-5 pb-6 pt-8'}`}
      >
        {cover}
        {identity}
        <View className="w-full gap-3 pt-1">
          {unavailableNotice}
          {primaryButton}
          <View className="w-full flex-row gap-2">
            {secondaryButton ? <View className="flex-1">{secondaryButton}</View> : null}
            <IconButton
              icon={statusIcon}
              label={statusLabel}
              kind="secondary"
              disabled={offline}
              onPress={() => setStatusOpen(true)}
            />
            <IconButton
              icon="collections"
              label="Add to collection"
              kind="secondary"
              disabled={offline}
              onPress={() => void openCollections()}
            />
            {downloadAvailable ? (
              <IconButton
                icon={downloaded ? 'enabled' : 'acquire'}
                label={downloaded ? 'Manage offline downloads' : 'Download for offline'}
                kind="secondary"
                disabled={offline || downloadBusy}
                onPress={() => setDownloadOpen(true)}
              />
            ) : null}
          </View>
          {genreChips}
          {progressMeter}
          {syncBlock}
          {downloadStatus}
        </View>
      </View>
      {tabs.length > 1 ? (
        <DetailTabs tabs={tabs} active={activeTab} onChange={setDetailTab} />
      ) : (
        <Text accessibilityRole="header" className="text-lg font-sans-semibold text-ink">
          About this book
        </Text>
      )}
      <AnimatedView key={activeTab} entering={fadeIn} className="gap-3">
        {activeTab === 'about' ? descriptionBody : null}
        {activeTab === 'details' ? factsBody : null}
        {activeTab === 'editions' ? editionsBody : null}
      </AnimatedView>
      {requestBody ? (
        <DetailSection index={1} title="Get another format">
          {requestBody}
        </DetailSection>
      ) : null}
    </View>
  );

  return (
    <Page
      title="Book details"
      hideHeader
      back={<IconButton icon="back" label="Back" kind="quiet" onPress={() => goBackOr('/books')} />}
      mobileActions={
        canEdit ? (
          <IconButton icon="settings" label="Manage this work" kind="quiet" onPress={openManage} />
        ) : undefined
      }
    >
      {width >= 820 ? (
        <View
          className={`mx-auto w-full flex-row items-center justify-between ${split ? 'max-w-[1080px]' : 'max-w-[720px]'}`}
        >
          <IconButton icon="back" label="Back" kind="quiet" onPress={() => goBackOr('/books')} />
          {canEdit ? (
            <Button label="Manage this work" icon="settings" kind="quiet" onPress={openManage} />
          ) : null}
        </View>
      ) : null}

      {offline ? (
        <Notice tone="info">
          You&apos;re offline — showing what&apos;s downloaded on this device.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Animated.View entering={fadeIn}>{split ? splitLayout : showcaseLayout}</Animated.View>

      <DownloadFormatDialog
        visible={downloadOpen}
        epubBytes={selectedEPUB?.size_bytes}
        audioBytes={selectedAudio?.size_bytes}
        onClose={() => setDownloadOpen(false)}
        onDownload={(format) => void startOfflineDownload(format)}
      />
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
