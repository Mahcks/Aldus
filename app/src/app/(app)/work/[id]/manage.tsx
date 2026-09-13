import { RepresentationGroup } from '@/components/catalog/RepresentationGroup';
import { CoverAssetCard, CoverCandidateCard } from '@/components/catalog/CoverCards';
import { RevisionChoiceList, SyncSourceSummary } from '@/components/catalog/AlignmentSources';
import {
  alignmentJobHint,
  alignmentJobTone,
  alignmentJobLabel,
  alignmentNoticeTone,
} from '@/lib/catalog/alignment-status';
import { AlignmentProgress, alignmentRunning } from '@/components/catalog/alignment-progress';
import { MetadataReviewDialog } from '@/components/catalog/MetadataReviewDialog';
import { seriesPositionError } from '@/lib/catalog/catalog-metadata';
import type { CoverAsset, GenreTag, Representation, WorkDetail } from '@/generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { BookCover } from '@/components/catalog/bookshelf';
import { useAuth } from '@/components/auth/AuthProvider';
import { TechnicalDetails } from '@/components/sources/TechnicalDetails';
import { Pressable, ScrollView, Text, View } from '@/components/ui/tw';
import {
  Button,
  IconButton,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Loading,
  Notice,
  Row,
  Section,
  SearchField,
  Select,
  StatusBadge,
  shared,
} from '@/components/ui';
import { GenreTagChip } from '@/components/catalog/GenreTagChip';
import { Page } from '@/components/shell/Page';
import { goBackOr } from '@/lib/navigation';
import { useWorkManagement } from '@/hooks/catalog/useWorkManagement';
import { useWorkMetadata } from '@/hooks/catalog/useWorkMetadata';
import { useWorkArtwork } from '@/hooks/catalog/useWorkArtwork';

const terminal = new Set(['ready', 'failed', 'stale']);

const manageTabs = [
  { value: 'details', label: 'Details' },
  { value: 'artwork', label: 'Artwork' },
  { value: 'files', label: 'Files' },
  { value: 'sync', label: 'Sync' },
] as const;
type ManageTab = (typeof manageTabs)[number]['value'];

function manageTab(value?: string): ManageTab {
  if (value === 'cover') return 'artwork';
  if (value === 'representations') return 'files';
  if (value === 'alignment') return 'sync';
  if (value === 'settings') return 'details';
  return manageTabs.some((entry) => entry.value === value) ? (value as ManageTab) : 'details';
}

/**
 * Explains, honestly, where the cover currently on screen came from — a
 * deliberate pick, artwork automatically pulled from the format's own file,
 * or a fallback because that file has no cover of its own. Without this,
 * "Cover studio" just showed a badge that always said "Format artwork" even
 * when it was quietly showing the other available cover instead.
 */
function coverProvenanceFor(
  format: 'ebook' | 'audiobook',
  coverURL: string | undefined,
  fallbackCoverURL: string | undefined,
  selectedAsset: CoverAsset | undefined,
): { tone: 'neutral' | 'success' | 'warning'; label: string; detail: string } {
  const formatLabel = format === 'audiobook' ? 'audiobook' : 'ebook';

  // `coverURL` alone isn't proof anything usable exists: the backend builds
  // an automatic media-cover URL for the newest ebook/audiobook file whether
  // or not that file actually has extractable artwork, and a broken one
  // fails to load silently. The verified signal is `selectedAsset` — the
  // "Artwork library" gallery only ever lists covers Aldus actually
  // confirmed it could extract, so a real automatic cover always appears
  // there. No match means there's nothing usable, not a chosen cover.
  if (!coverURL || !selectedAsset) {
    return {
      tone: 'warning',
      label: 'No cover of its own',
      detail: fallbackCoverURL
        ? `This ${formatLabel} file has no usable cover art, so Aldus is showing the other available cover instead.`
        : `This ${formatLabel} file has no usable cover art, and no other cover is available either — Aldus is showing a generated design instead.`,
    };
  }

  if (selectedAsset.source === 'embedded') {
    return {
      tone: 'success',
      label: 'Automatic — from the file',
      detail: selectedAsset.original_filename
        ? `Embedded artwork from ${selectedAsset.original_filename}.`
        : 'Embedded artwork from this file.',
    };
  }

  return {
    tone: 'success',
    label: selectedAsset?.source === 'upload' ? 'Uploaded image' : 'Selected artwork',
    detail: `Chosen specifically for the ${formatLabel} cover.`,
  };
}
export default function ManageWorkScreen() {
  const { id, tab: tabParam } = useLocalSearchParams<{
    id: string;
    tab?: string;
  }>();
  const auth = useAuth();
  const narrow = useWindowDimensions().width < 600;
  const initialTab = manageTab(tabParam);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState('');
  const [metadataReviewOpen, setMetadataReviewOpen] = useState(false);
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const management = useWorkManagement(id, applyLoadedWork);
  const artwork = useWorkArtwork(id, management, setMetadataMessage);
  const metadata = useWorkMetadata(id, management, artwork.refreshCoverAssets, setMetadataMessage);
  const {
    work,
    library,
    representations,
    media,
    jobs,
    loading,
    error,
    deletingWork,
    addFileOpen,
    setAddFileOpen,
    addingFile,
    alignmentBusy,
    cancelingJobID,
    kind,
    setKind,
    label,
    setLabel,
    epubID,
    setEPUBID,
    audioID,
    setAudioID,
    epubs,
    audio,
    selectedEPUB,
    selectedAudio,
    progressUnreachable,
    addFile,
    enqueue,
    cancelJob,
    deleteWork,
  } = management;
  const {
    deletingCoverID,
    setDeletingCoverID,
    coverFormat,
    setCoverFormat,
    coverSearchVersion: coverSearchVersionRef,
    coverSearched,
    setCoverSearched,
    coverQuery,
    setCoverQuery,
    coverCandidates,
    setCoverCandidates,
    coverAssets,
    setCoverAssets,
    searchingCovers,
    setSearchingCovers,
    savingCover,
    generatedStyle,
    setGeneratedStyle,
    generatedTone,
    setGeneratedTone,
    generatedLayout,
    setGeneratedLayout,
    searchCovers,
    chooseCover,
    restoreCover,
    saveCoverSettings,
    deleteCover,
    uploadCover,
  } = artwork;
  const {
    savingDetails,
    savingGenres,
    title,
    setTitle,
    author,
    setAuthor,
    description,
    setDescription,
    isbn,
    setISBN,
    publishYear,
    setPublishYear,
    series,
    setSeries,
    seriesPosition,
    setSeriesPosition,
    publisher,
    setPublisher,
    language,
    setLanguage,
    subjects,
    setSubjects,
    allGenreTags,
    genreMode,
    setGenreMode,
    selectedGenreIDs,
    refreshingMetadata,
    detailsDirty,
    saveWorkSettings,
    saveGenres,
    toggleGenre,
    metadataApplied,
    refreshMetadata,
  } = metadata;
  function applyLoadedWork(
    nextWork: WorkDetail,
    nextRepresentations: Representation[],
    nextGenreTags: GenreTag[],
  ) {
    metadata.applyLoadedWork(nextWork, nextGenreTags);
    artwork.applyLoadedWork(nextWork, nextRepresentations);
  }

  if (loading)
    return (
      <Page title="Manage work" editorial={false}>
        <Loading layout="details" label="Loading work…" />
      </Page>
    );
  if (!work)
    return (
      <Page title="Manage work" editorial={false}>
        <Notice danger>{error || 'Work unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(
    auth.user?.admin || library?.role === 'owner' || library?.role === 'editor',
  );
  const selectedPairJob = jobs.find(
    (job) => job.epub_media_id === epubID && job.audio_media_id === audioID,
  );
  const coverURL = coverFormat === 'ebook' ? work.ebook_cover_url : work.audiobook_cover_url;
  const selectedCoverAsset = coverAssets.find((asset) => asset.image_url === coverURL);
  const coverFormatLabel = coverFormat === 'ebook' ? 'Ebook cover' : 'Audiobook cover';
  const coverFormatDescription =
    coverFormat === 'ebook'
      ? 'Used for the ebook and while browsing your library. Choosing an image saves immediately.'
      : 'Used while listening, and for browsing audiobook-only books. Choosing an image saves immediately.';
  const coverProvenance = coverProvenanceFor(
    coverFormat,
    coverURL,
    work.cover_url,
    selectedCoverAsset,
  );
  const syncRunning =
    selectedPairJob?.state === 'pending' || selectedPairJob?.state === 'processing';
  const syncReady = selectedPairJob?.state === 'ready';
  const syncActionLabel = syncRunning
    ? 'Sync in progress'
    : syncReady
      ? 'Sync ready'
      : selectedPairJob?.state === 'failed'
        ? 'Retry sync'
        : selectedPairJob?.state === 'stale'
          ? 'Rebuild sync'
          : 'Create sync';

  function backToWork() {
    goBackOr(`/work/${id}`);
  }

  function selectTab(next: ManageTab) {
    if (next === activeTab) return;
    setActiveTab(next);
    router.setParams({ tab: next });
  }

  if (!canEdit)
    return (
      <Page
        title="Manage work"
        back={<IconButton label="Back" icon="back" kind="quiet" onPress={backToWork} />}
        editorial={false}
      >
        <Notice danger>You don&apos;t have permission to manage this work.</Notice>
      </Page>
    );

  return (
    <Page
      title="Manage work"
      back={<IconButton label="Back" icon="back" kind="quiet" onPress={backToWork} />}
      editorial={false}
    >
      <View className="w-full max-w-[1000px] self-center gap-6">
        <View className="flex-row items-center gap-4 border-b border-line pb-4">
          <BookCover
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            size="mini"
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text numberOfLines={2} className="font-editorial-bold text-2xl text-ink">
              {work.title}
            </Text>
            <Text className="text-sm text-muted">
              {[work.author, library?.name].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        {error ? <Notice danger>{error}</Notice> : null}
        {metadataMessage ? <Notice tone="success">{metadataMessage}</Notice> : null}
        <ScrollView
          horizontal
          accessibilityRole="tablist"
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="min-w-full flex-row border-b border-line"
        >
          {manageTabs.map((tab) => (
            <ManageTabItem
              key={tab.value}
              label={tab.label}
              selected={activeTab === tab.value}
              onPress={() => selectTab(tab.value)}
            />
          ))}
        </ScrollView>

        {activeTab === 'artwork' ? (
          <View className="gap-8">
            <View className="gap-4">
              <Select
                label="Artwork for"
                disabled={Boolean(savingCover)}
                value={coverFormat}
                options={[
                  { value: 'ebook', label: 'Ebook cover' },
                  { value: 'audiobook', label: 'Audiobook cover' },
                ]}
                onChange={(value) => {
                  coverSearchVersionRef.current += 1;
                  setCoverCandidates([]);
                  setCoverAssets([]);
                  setCoverSearched(false);
                  setSearchingCovers(false);
                  setCoverFormat(value as 'ebook' | 'audiobook');
                }}
              />
              <View className="gap-1 rounded-control bg-panel px-4 py-3">
                <Text className="font-sans-bold text-base text-ink">
                  Editing: {coverFormatLabel}
                </Text>
                <Text className={shared.itemMeta}>{coverFormatDescription}</Text>
              </View>
            </View>
            <Section
              title="Cover studio"
              action={
                <Button
                  label={savingCover === 'upload' ? 'Uploading…' : 'Upload image'}
                  icon="upload"
                  kind="secondary"
                  disabled={Boolean(savingCover)}
                  onPress={() => void uploadCover()}
                />
              }
            >
              <View
                className={`flex-row flex-wrap items-start gap-8 ${narrow ? 'justify-center' : ''}`}
              >
                <View className="w-[220px] items-center gap-3">
                  <BookCover
                    title={work.title}
                    author={work.author}
                    coverURL={coverURL}
                    fallbackCoverURL={coverFormat ? work.cover_url : undefined}
                    size={coverFormat === 'audiobook' ? 'audio' : 'hero'}
                    coverFit="cover"
                    coverFocalX={50}
                    coverFocalY={50}
                    generatedCoverStyle={generatedStyle}
                    generatedCoverTone={Number(generatedTone)}
                    generatedCoverLayout={generatedLayout}
                  />
                  <StatusBadge tone={coverProvenance.tone} label={coverProvenance.label} />
                  <Text className="text-center text-xs text-muted">{coverProvenance.detail}</Text>
                </View>
                {coverFormat === 'audiobook' ? (
                  <View className="w-full gap-4 sm:min-w-[280px] sm:max-w-md sm:flex-1">
                    <Text className={shared.itemMeta}>
                      Choose an image below or upload your own — saves immediately and changes only
                      the {coverFormat} cover. Your original {coverFormat} file is never modified.
                    </Text>
                    <Button
                      label="Use automatic artwork"
                      kind="secondary"
                      loading={savingCover === 'restore'}
                      disabled={Boolean(savingCover)}
                      onPress={() => void restoreCover()}
                    />
                  </View>
                ) : (
                  <View className="min-w-[280px] max-w-[640px] flex-1 gap-6">
                    {work.cover_url ? (
                      <Button
                        label={fallbackOpen ? 'Hide fallback design' : 'Edit fallback design'}
                        kind="quiet"
                        onPress={() => setFallbackOpen((value) => !value)}
                      />
                    ) : null}
                    {!work.cover_url || fallbackOpen ? (
                      <View className="gap-5 border-t border-line pt-5">
                        <View className="gap-1">
                          <Text className="text-base font-sans-bold text-ink">
                            {work.cover_url ? 'Fallback cover' : 'Generated cover'}
                          </Text>
                          <Text className={shared.itemMeta}>
                            {work.cover_url
                              ? 'Used if the selected artwork is removed.'
                              : 'Used now because no custom artwork is selected.'}
                          </Text>
                        </View>
                        {work.cover_url ? (
                          <BookCover
                            title={work.title}
                            author={work.author}
                            size="small"
                            generatedCoverStyle={generatedStyle}
                            generatedCoverTone={Number(generatedTone)}
                            generatedCoverLayout={generatedLayout}
                          />
                        ) : null}
                        <Select
                          label="Design"
                          value={generatedStyle}
                          options={[
                            { value: 'classic', label: 'Classic' },
                            { value: 'minimal', label: 'Minimal' },
                            { value: 'framed', label: 'Framed' },
                          ]}
                          onChange={(value) =>
                            setGeneratedStyle(value as 'classic' | 'minimal' | 'framed')
                          }
                        />
                        <Select
                          label="Title position"
                          value={generatedLayout}
                          options={[
                            { value: 'top', label: 'Top' },
                            { value: 'center', label: 'Center' },
                            { value: 'bottom', label: 'Bottom' },
                          ]}
                          onChange={(value) =>
                            setGeneratedLayout(value as 'top' | 'center' | 'bottom')
                          }
                        />
                        <Select
                          label="Cloth color"
                          value={generatedTone}
                          options={[
                            { value: '-1', label: 'Automatic' },
                            { value: '0', label: 'Ink' },
                            { value: '1', label: 'Umber' },
                            { value: '2', label: 'Terracotta' },
                            { value: '3', label: 'Slate' },
                            { value: '4', label: 'Sage' },
                          ]}
                          onChange={setGeneratedTone}
                        />
                      </View>
                    ) : null}
                    <View className="gap-3 border-t border-line pt-5">
                      <Text className={shared.itemMeta}>
                        The ebook cover is also used while browsing. These settings control the
                        generated fallback design.
                      </Text>
                      <Row>
                        <Button
                          label="Save fallback design"
                          kind="primary"
                          loading={savingCover === 'settings'}
                          disabled={Boolean(savingCover)}
                          onPress={() => void saveCoverSettings()}
                        />
                        {work.cover_url ? (
                          <Button
                            label="Use automatic artwork"
                            kind="secondary"
                            loading={savingCover === 'restore'}
                            disabled={Boolean(savingCover)}
                            onPress={() => void restoreCover()}
                          />
                        ) : null}
                      </Row>
                    </View>
                  </View>
                )}
              </View>
            </Section>

            <Section title="Artwork library">
              <Text className={shared.itemMeta}>
                {coverFormat
                  ? `Images embedded in the ${coverFormat} file, plus anything uploaded or chosen before — any of these can become the ${coverFormat} cover.`
                  : 'Embedded, uploaded, and previously selected images stay available here.'}
              </Text>
              {coverAssets.length ? (
                <View
                  className={`flex-row flex-wrap items-start gap-5 ${narrow ? 'justify-center' : ''}`}
                >
                  {coverAssets.map((asset) => (
                    <CoverAssetCard
                      key={`${asset.source}-${asset.source_id}`}
                      asset={{ ...asset, selected: asset.image_url === coverURL }}
                      audioArtwork={coverFormat === 'audiobook'}
                      work={work}
                      disabled={Boolean(savingCover)}
                      selecting={savingCover === asset.source_id}
                      onSelect={() =>
                        void chooseCover({
                          source: asset.source,
                          source_id: asset.source_id,
                        })
                      }
                      onDelete={
                        asset.source === 'upload' && asset.id
                          ? () => setDeletingCoverID(asset.id as string)
                          : undefined
                      }
                    />
                  ))}
                </View>
              ) : (
                <Text className={shared.itemMeta}>
                  {coverFormat
                    ? `No embedded, uploaded, or previously chosen artwork is available for the ${coverFormat} cover yet.`
                    : 'No other artwork is saved for this book.'}
                </Text>
              )}
            </Section>

            <Section
              title={
                coverFormat === 'audiobook' ? 'Find audiobook artwork' : 'Find another book cover'
              }
            >
              <Text className={shared.itemMeta}>
                {coverFormat === 'audiobook'
                  ? 'Search audio editions only. Results use the audiobook edition’s own artwork.'
                  : 'Search Open Library by title, author, or ISBN.'}
              </Text>
              <View className={shared.form}>
                <SearchField label="Search terms" value={coverQuery} onChangeText={setCoverQuery} />
                <View className="self-start">
                  <Button
                    label={
                      searchingCovers
                        ? 'Searching…'
                        : coverFormat === 'audiobook'
                          ? 'Search audiobook covers'
                          : 'Search Open Library'
                    }
                    icon="search"
                    kind="primary"
                    disabled={searchingCovers || !coverQuery.trim()}
                    onPress={() => void searchCovers()}
                  />
                </View>
              </View>
              {coverCandidates.length ? (
                <View
                  className={`flex-row flex-wrap items-start gap-5 ${narrow ? 'justify-center' : ''}`}
                >
                  {coverCandidates.map((candidate) => (
                    <CoverCandidateCard
                      key={`${candidate.source}-${candidate.source_id}`}
                      candidate={candidate}
                      fallbackTitle={work.title}
                      fallbackAuthor={work.author}
                      selecting={savingCover === candidate.source_id}
                      disabled={Boolean(savingCover)}
                      onPress={() => void chooseCover(candidate)}
                    />
                  ))}
                </View>
              ) : null}
              {!searchingCovers && coverCandidates.length === 0 ? (
                <Text className={shared.itemMeta}>
                  {coverSearched
                    ? coverFormat === 'audiobook'
                      ? 'No audiobook editions with their own cover were found. Try a shorter title or an audiobook ISBN, or upload an image.'
                      : 'No covers found. Try a shorter title or ISBN.'
                    : 'Choose the edition that matches your book.'}
                </Text>
              ) : null}
            </Section>
          </View>
        ) : null}

        {activeTab === 'files' ? (
          <Section
            title="Files"
            action={
              <Button
                label="Add file"
                icon="add"
                kind="primary"
                onPress={() => setAddFileOpen(true)}
              />
            }
          >
            <Text className={shared.itemMeta}>
              Keep reading editions and audiobook narrations together. Open an edition to review its
              uploads or add a newer file.
            </Text>
            {representations.length === 0 ? (
              <EmptyState
                icon="folder"
                title="No ebook or audiobook files yet"
                action={
                  <Button label="Add file" kind="primary" onPress={() => setAddFileOpen(true)} />
                }
              >
                Add an EPUB or audiobook to make this work available to readers.
              </EmptyState>
            ) : (
              <View className="gap-6">
                <RepresentationGroup
                  title="Reading editions"
                  items={representations.filter((item) => item.kind === 'epub')}
                  media={media}
                />
                <RepresentationGroup
                  title="Audiobook narrations"
                  items={representations.filter(
                    (item) => item.kind === 'audio' || item.kind === 'audiobook',
                  )}
                  media={media}
                />
              </View>
            )}
          </Section>
        ) : null}

        {activeTab === 'sync' ? (
          <View className="gap-8">
            <Section title="Read + Listen sync">
              <Text className="max-w-[680px] text-base leading-6 text-muted">
                Match one reading edition with one narration so readers can switch at the same
                sentence.
              </Text>
              {!selectedEPUB || !selectedAudio ? (
                <EmptyState
                  icon="synced"
                  title="An ebook and audiobook are required"
                  action={
                    <Button
                      label="Review files"
                      kind="primary"
                      onPress={() => selectTab('files')}
                    />
                  }
                >
                  Add both formats in Files before creating synchronized reading and listening.
                </EmptyState>
              ) : (
                <View className="gap-6">
                  <View className="gap-4 border-y border-line py-5">
                    <View className="flex-row flex-wrap items-center justify-between gap-3">
                      <Text className="text-base font-sans-bold text-ink">Selected pair</Text>
                      <StatusBadge
                        tone={selectedPairJob ? alignmentJobTone(selectedPairJob.state) : 'neutral'}
                        label={
                          selectedPairJob ? alignmentJobLabel(selectedPairJob.state) : 'Not synced'
                        }
                      />
                    </View>
                    <View className={shared.split}>
                      <SyncSourceSummary title="Reading edition" item={selectedEPUB} />
                      <SyncSourceSummary title="Narration" item={selectedAudio} />
                    </View>
                    {selectedPairJob && alignmentRunning(selectedPairJob) ? (
                      <AlignmentProgress job={selectedPairJob} unreachable={progressUnreachable} />
                    ) : selectedPairJob ? (
                      <Notice tone={alignmentNoticeTone(selectedPairJob.state)}>
                        {alignmentJobHint(selectedPairJob)}
                      </Notice>
                    ) : (
                      <Text className={shared.itemMeta}>
                        These files have not been synchronized yet.
                      </Text>
                    )}
                  </View>

                  {epubs.length > 1 || audio.length > 1 ? (
                    <View className="gap-3">
                      <Text className="text-base font-sans-bold text-ink">Choose source files</Text>
                      <View className={shared.split}>
                        <RevisionChoiceList
                          title="Reading edition"
                          items={epubs}
                          selected={epubID}
                          onSelect={setEPUBID}
                        />
                        <RevisionChoiceList
                          title="Narration"
                          items={audio}
                          selected={audioID}
                          onSelect={setAudioID}
                        />
                      </View>
                    </View>
                  ) : null}

                  <View className="items-start gap-2">
                    {syncRunning && selectedPairJob ? (
                      <Button
                        label="Cancel sync"
                        kind="danger"
                        loading={cancelingJobID === selectedPairJob.id}
                        disabled={Boolean(cancelingJobID)}
                        onPress={() => void cancelJob(selectedPairJob.id)}
                      />
                    ) : (
                      <Button
                        label={syncActionLabel}
                        kind="primary"
                        loading={alignmentBusy}
                        disabled={alignmentBusy || syncRunning || syncReady}
                        onPress={() => void enqueue()}
                      />
                    )}
                    <Text className={shared.itemMeta}>
                      Alignment runs on the server. You can safely leave this page.
                    </Text>
                  </View>
                </View>
              )}
            </Section>

            {jobs.length ? (
              <Section title="Sync history">
                <Button
                  label={historyOpen ? 'Hide sync history' : 'Show sync history'}
                  kind="quiet"
                  onPress={() => setHistoryOpen(!historyOpen)}
                />
                {historyOpen
                  ? jobs.map((job) => {
                      const epubMedia = media.find((item) => item.id === job.epub_media_id);
                      const audioMedia = media.find((item) => item.id === job.audio_media_id);
                      return (
                        <View key={job.id} className={shared.listItem}>
                          <View className="flex-row flex-wrap items-center gap-2">
                            <StatusBadge
                              tone={alignmentJobTone(job.state)}
                              label={alignmentJobLabel(job.state)}
                            />
                            <Text className={shared.itemMeta}>
                              {new Date(job.created_at).toLocaleString()}
                            </Text>
                          </View>
                          <Text className={shared.itemTitle}>
                            {epubMedia?.original_filename ||
                              epubMedia?.representation.label ||
                              'EPUB'}
                            {' + '}
                            {audioMedia?.original_filename ||
                              audioMedia?.representation.label ||
                              'Audiobook'}
                          </Text>
                          <Text className={shared.itemMeta}>{alignmentJobHint(job)}</Text>
                          <TechnicalDetails
                            rows={[
                              { label: 'Job ID', value: job.id, copyable: true },
                              { label: 'EPUB media ID', value: job.epub_media_id, copyable: true },
                              {
                                label: 'Audio media ID',
                                value: job.audio_media_id,
                                copyable: true,
                              },
                              ...(job.alignment_id
                                ? [
                                    {
                                      label: 'Alignment ID',
                                      value: job.alignment_id,
                                      copyable: true,
                                    },
                                  ]
                                : []),
                              ...(job.error
                                ? [{ label: 'Error', value: job.error, copyable: true }]
                                : []),
                            ]}
                          />
                          {!terminal.has(job.state) ? (
                            <View className="self-start">
                              <Button
                                label="Cancel"
                                kind="danger"
                                loading={cancelingJobID === job.id}
                                disabled={Boolean(cancelingJobID)}
                                onPress={() => void cancelJob(job.id)}
                              />
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  : null}
              </Section>
            ) : null}
          </View>
        ) : null}

        {activeTab === 'details' ? (
          <View className="gap-8">
            <View className="gap-4 border-b border-line-subtle pb-5">
              <View className="max-w-[760px] gap-3">
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="Find book details"
                    icon="search"
                    kind="secondary"
                    disabled={detailsDirty || savingDetails || refreshingMetadata}
                    onPress={() => setMetadataReviewOpen(true)}
                  />
                  <Button
                    label="Fill missing"
                    kind="quiet"
                    loading={refreshingMetadata}
                    disabled={detailsDirty || refreshingMetadata || savingDetails}
                    onPress={() => void refreshMetadata()}
                  />
                </View>
                {detailsDirty ? (
                  <Text className="text-sm text-muted">
                    Save your manual edits below before finding details online.
                  </Text>
                ) : (
                  <Text className="text-sm text-muted">
                    Find an edition to compare, or fill missing details without replacing your
                    edits.
                  </Text>
                )}
              </View>
              {metadataReviewOpen ? (
                <MetadataReviewDialog
                  workID={id}
                  initialQuery={`${work.title} ${work.author || ''}`.trim()}
                  onClose={() => setMetadataReviewOpen(false)}
                  onApplied={metadataApplied}
                />
              ) : null}
            </View>
            <Section title="Book details">
              <View className="max-w-[760px] gap-4">
                <Field label="Title" value={title} onChangeText={setTitle} />
                <Field label="Author" value={author} onChangeText={setAuthor} />
                <Field
                  label="Description"
                  value={description}
                  multiline
                  numberOfLines={6}
                  className="min-h-32"
                  onChangeText={setDescription}
                />
                <View className="border-y border-line-subtle py-2">
                  <Button
                    label={
                      publicationOpen
                        ? 'Hide publication details'
                        : 'Series, publication & subjects'
                    }
                    kind="quiet"
                    icon={publicationOpen ? 'chevronUp' : 'chevronDown'}
                    onPress={() => setPublicationOpen((open) => !open)}
                  />
                </View>
                {publicationOpen ? (
                  <View className="gap-4">
                    <View className="flex-row flex-wrap gap-4">
                      <View className="min-w-[220px] flex-grow basis-[280px]">
                        <Field
                          label="Series"
                          maxLength={200}
                          value={series}
                          onChangeText={(value) => {
                            setSeries(value);
                            if (!value.trim()) setSeriesPosition('');
                          }}
                        />
                      </View>
                      <View className="min-w-[160px] flex-grow basis-[180px]">
                        <Field
                          label="Position in series"
                          error={seriesPositionError(seriesPosition)}
                          value={seriesPosition}
                          onChangeText={setSeriesPosition}
                          help="Optional. Use 0, 1, or 1.5; up to three decimal places."
                        />
                      </View>
                    </View>
                    <View className="flex-row flex-wrap gap-4">
                      <View className="min-w-[220px] flex-grow basis-[280px]">
                        <Field label="Publisher" value={publisher} onChangeText={setPublisher} />
                      </View>
                      <View className="min-w-[160px] flex-grow basis-[180px]">
                        <Field
                          label="Publication year"
                          value={publishYear}
                          keyboardType="number-pad"
                          onChangeText={setPublishYear}
                        />
                      </View>
                    </View>
                    <View className="flex-row flex-wrap gap-4">
                      <View className="min-w-[220px] flex-grow basis-[280px]">
                        <Field label="ISBN" value={isbn} onChangeText={setISBN} />
                      </View>
                      <View className="min-w-[160px] flex-grow basis-[180px]">
                        <Field label="Language" value={language} onChangeText={setLanguage} />
                      </View>
                    </View>
                    <Field
                      label="Subjects"
                      help="One subject per line. Genres are assigned from these values."
                      value={subjects}
                      multiline
                      numberOfLines={5}
                      className="min-h-28"
                      onChangeText={setSubjects}
                    />
                  </View>
                ) : null}
                <View className="self-start">
                  <Button
                    label="Save details"
                    kind="primary"
                    loading={savingDetails}
                    disabled={savingDetails || !title.trim()}
                    onPress={() => void saveWorkSettings()}
                  />
                </View>
              </View>
            </Section>
            <Section title="Genres">
              <View className="max-w-[760px] gap-5">
                <Select
                  label="Assignment"
                  value={genreMode}
                  options={[
                    { value: 'automatic', label: 'Match from subjects' },
                    { value: 'manual', label: 'Choose manually' },
                  ]}
                  onChange={(value) => setGenreMode(value as 'automatic' | 'manual')}
                />
                {genreMode === 'automatic' ? (
                  <View className="gap-3 border-y border-line py-4">
                    <Text className={shared.itemMeta}>
                      Aldus matches the subjects above against the genre rules configured for this
                      server.
                    </Text>
                    {work.genre_tags.length ? (
                      <View className="flex-row flex-wrap gap-2">
                        {work.genre_tags.map((tag) => (
                          <GenreTagChip key={tag.id} icon={tag.icon} label={tag.label} />
                        ))}
                      </View>
                    ) : (
                      <Text className="text-sm text-muted">No genres currently match.</Text>
                    )}
                  </View>
                ) : (
                  <View className="gap-2">
                    <Text className={shared.itemMeta}>
                      This exact selection replaces automatic matching for this work.
                    </Text>
                    <View className="flex-row flex-wrap gap-x-6 gap-y-1 border-y border-line py-3">
                      {allGenreTags.map((tag) => (
                        <View key={tag.id} className="min-w-[180px] flex-grow basis-[220px]">
                          <Checkbox
                            label={tag.label}
                            checked={selectedGenreIDs.includes(tag.id)}
                            onPress={() => toggleGenre(tag.id)}
                          />
                        </View>
                      ))}
                    </View>
                    {!selectedGenreIDs.length ? (
                      <Text className="text-sm text-muted">
                        No genres selected. This work will appear without genre tags.
                      </Text>
                    ) : null}
                  </View>
                )}
                <View className="self-start">
                  <Button
                    label="Save genres"
                    kind="primary"
                    loading={savingGenres}
                    disabled={savingGenres}
                    onPress={() => void saveGenres()}
                  />
                </View>
              </View>
            </Section>
            <Section title="Delete work">
              <View className="max-w-[760px] gap-3">
                <Text className={shared.itemMeta}>
                  {representations.length
                    ? 'This work still has files. Remove its reading editions and narrations before deleting it.'
                    : 'Permanently remove this work from the library.'}
                </Text>
                <Row>
                  {representations.length ? (
                    <Button
                      label="Review files"
                      kind="secondary"
                      onPress={() => selectTab('files')}
                    />
                  ) : null}
                  <Button
                    label="Delete work"
                    kind="danger"
                    disabled={representations.length > 0}
                    onPress={() => setConfirmingDelete(true)}
                  />
                </Row>
              </View>
            </Section>
          </View>
        ) : null}
      </View>

      <Dialog
        visible={addFileOpen}
        title="Add file"
        sheet
        footer={
          <Button
            label="Choose file"
            kind="primary"
            loading={addingFile}
            disabled={addingFile || !label.trim()}
            onPress={() => void addFile()}
          />
        }
        onClose={() => !addingFile && setAddFileOpen(false)}
      >
        <View className="gap-5">
          <Select
            label="Format"
            options={[
              { value: 'epub', label: 'Ebook' },
              { value: 'audiobook', label: 'Audiobook' },
            ]}
            value={kind}
            onChange={setKind}
          />
          <Field
            label={kind === 'epub' ? 'Edition label' : 'Narration label'}
            value={label}
            placeholder={kind === 'epub' ? 'Standard EPUB' : 'Narrated by…'}
            onChangeText={setLabel}
          />
          <Text className={shared.itemMeta}>
            You will choose the file next. Aldus validates it before adding anything to this work.
          </Text>
        </View>
      </Dialog>

      <ConfirmDialog
        visible={Boolean(deletingCoverID)}
        onClose={() => setDeletingCoverID('')}
        onConfirm={() => void deleteCover(deletingCoverID)}
        title="Delete uploaded cover?"
        description="The image will be removed from this book. Any ebook or audiobook cover using it returns to its default. Your original files are unaffected."
        confirmLabel="Delete upload"
        danger
        busy={savingCover === deletingCoverID}
      />
      <ConfirmDialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void deleteWork()}
        title="Delete work?"
        description="This cannot be undone. The work must have no representations before it can be deleted."
        confirmLabel="Delete"
        danger
        busy={deletingWork}
      />
    </Page>
  );
}

/** Flat underline tab, kept on one horizontal row by the parent ScrollView. */
function ManageTabItem({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  // A full outline box reads wrong on a flat underline tab; keyboard focus gets its
  // own border color on the same underline instead of `resolvePressStateClass`'s box.
  const borderClass = focused ? 'border-focus' : selected ? 'border-accent' : 'border-transparent';
  const textClass = selected ? 'text-accent' : 'text-muted';
  const opacityClass = pressed ? 'opacity-75' : '';

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-1 items-center justify-center border-b-2 px-4 pb-3 ${borderClass} ${opacityClass}`}
    >
      <Text className={`text-sm font-sans-bold ${textClass}`}>{label}</Text>
    </Pressable>
  );
}
