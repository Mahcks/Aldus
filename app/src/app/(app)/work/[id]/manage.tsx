import type {
  AlignmentJob,
  CoverAsset,
  CoverCandidate,
  Representation,
  Work,
} from '../../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { choices, type MediaChoice } from '../../../../features/consumption';
import { BookCover, coverPresentation } from '../../../../features/bookshelf';
import { useAuth } from '../../../../features/auth/AuthProvider';
import { representationKinds } from '../../../../features/source-administration';
import { TechnicalDetails } from '../../../../features/sources/TechnicalDetails';
import { Pressable, Text, View } from '../../../../features/tw';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  resolvePressStateClass,
  Row,
  Section,
  SearchField,
  Select,
  StatusBadge,
  shared,
} from '../../../../features/ui';
import { api, errorMessage } from '../../../../lib/api';
import { goBackOr } from '../../../../lib/navigation';

const terminal = new Set(['ready', 'failed', 'stale']);
const manageTabs = [
  { value: 'cover', label: 'Cover' },
  { value: 'representations', label: 'Representations' },
  { value: 'alignment', label: 'Alignment' },
  { value: 'settings', label: 'Settings' },
] as const;
type ManageTab = (typeof manageTabs)[number]['value'];

function alignmentJobTone(state: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (state === 'ready') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'stale') return 'warning';
  if (state === 'processing') return 'info';
  return 'neutral';
}

function alignmentJobHint(state: string) {
  if (state === 'ready') return 'Ready — readers can switch between reading and listening in sync.';
  if (state === 'failed') return 'Alignment failed. See technical details, then try again.';
  if (state === 'stale')
    return 'One of the source files changed since this finished. Start a new alignment to keep sync accurate.';
  if (state === 'processing') return 'Aligning now — this can take a few minutes.';
  return 'Queued to begin shortly.';
}

export default function ManageWorkScreen() {
  const {
    id,
    libraryId,
    role = '',
    tab: tabParam,
  } = useLocalSearchParams<{ id: string; libraryId: string; role?: string; tab?: string }>();
  const auth = useAuth();
  const initialTab: ManageTab = manageTabs.some((entry) => entry.value === tabParam)
    ? (tabParam as ManageTab)
    : 'cover';
  const [activeTab, setActiveTab] = useState(initialTab);
  const tabHistory = useRef<ManageTab[]>([initialTab]);
  const [work, setWork] = useState<Work>();
  const [representations, setRepresentations] = useState<Representation[]>([]);
  const [media, setMedia] = useState<MediaChoice[]>([]);
  const [jobs, setJobs] = useState<AlignmentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingCoverID, setDeletingCoverID] = useState('');
  const [deletingWork, setDeletingWork] = useState(false);
  const [kind, setKind] = useState('epub');
  const [label, setLabel] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [epubID, setEPUBID] = useState('');
  const [audioID, setAudioID] = useState('');
  const [coverQuery, setCoverQuery] = useState('');
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [coverAssets, setCoverAssets] = useState<CoverAsset[]>([]);
  const [searchingCovers, setSearchingCovers] = useState(false);
  const [savingCover, setSavingCover] = useState('');
  const [coverFit, setCoverFit] = useState<'cover' | 'contain'>('cover');
  const [coverFocalPoint, setCoverFocalPoint] = useState('50:50');
  const [generatedStyle, setGeneratedStyle] = useState<'classic' | 'minimal' | 'framed'>('classic');
  const [generatedTone, setGeneratedTone] = useState('-1');
  const [generatedLayout, setGeneratedLayout] = useState<'top' | 'center' | 'bottom'>('center');

  async function load() {
    if (!id || !libraryId) return;
    try {
      const [nextWork, nextRepresentations, nextJobs, nextCovers] = await Promise.all([
        api.work(id),
        api.representations(id),
        api.alignmentJobs(id),
        api.covers(id),
      ]);
      const revisions = await loadRevisions(libraryId, nextRepresentations);
      setWork(nextWork);
      setTitle(nextWork.title);
      setAuthor(nextWork.author || '');
      setCoverQuery((current) => current || `${nextWork.title} ${nextWork.author || ''}`.trim());
      setRepresentations(nextRepresentations);
      setMedia(revisions);
      setJobs(nextJobs);
      setCoverAssets(nextCovers);
      setCoverFit(nextWork.cover_fit);
      setCoverFocalPoint(`${nextWork.cover_focal_x}:${nextWork.cover_focal_y}`);
      setGeneratedStyle(nextWork.generated_cover_style);
      setGeneratedTone(String(nextWork.generated_cover_tone));
      setGeneratedLayout(nextWork.generated_cover_layout);
      setEPUBID((current) =>
        revisions.some((item) => item.id === current)
          ? current
          : (choices(nextRepresentations, revisions, ['epub'])[0]?.id ?? ''),
      );
      setAudioID((current) =>
        revisions.some((item) => item.id === current)
          ? current
          : (choices(nextRepresentations, revisions, ['audio', 'audiobook'])[0]?.id ?? ''),
      );
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, libraryId]);

  useEffect(() => {
    const active = jobs.filter((job) => !terminal.has(job.state));
    if (active.length === 0) return;
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        const updates = await Promise.all(active.map((job) => api.alignmentJob(job.id)));
        if (!canceled)
          setJobs((current) =>
            current.map((job) => updates.find((update) => update.id === job.id) || job),
          );
      } catch (value) {
        if (!canceled) setError(errorMessage(value));
      }
    }, 2000);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [jobs]);

  if (loading)
    return (
      <Page title="Manage work" editorial={false}>
        <Loading label="Loading work…" />
      </Page>
    );
  if (!work)
    return (
      <Page title="Manage work" editorial={false}>
        <Notice danger>{error || 'Work unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(auth.user?.admin || role === 'owner' || role === 'editor');
  const epubs = media.filter((item) => item.kind === 'epub');
  const audio = media.filter((item) => item.kind === 'audio' || item.kind === 'audiobook');
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);

  function backToWork() {
    if (activeTab !== 'cover') {
      tabHistory.current.pop();
      setActiveTab(tabHistory.current.at(-1) ?? 'cover');
      return;
    }
    goBackOr(`/work/${id}?libraryId=${libraryId}&role=${role}`);
  }

  function selectTab(next: ManageTab) {
    if (next === activeTab) return;
    tabHistory.current.push(next);
    setActiveTab(next);
  }

  async function createRepresentation() {
    try {
      await api.createRepresentation(id, { kind, label });
      setLabel('');
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function enqueue() {
    if (!selectedEPUB || !selectedAudio) return;
    try {
      const job = await api.enqueueAlignment({
        epub_media_id: selectedEPUB.id,
        epub_sha256: selectedEPUB.sha256,
        audio_media_id: selectedAudio.id,
        audio_sha256: selectedAudio.sha256,
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function cancelJob(jobID: string) {
    try {
      await api.cancelAlignment(jobID);
      const update = await api.alignmentJob(jobID);
      setJobs((current) => current.map((item) => (item.id === update.id ? update : item)));
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function saveWorkSettings() {
    try {
      await api.updateWork(id, { title, author });
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function searchCovers() {
    setSearchingCovers(true);
    setError('');
    try {
      setCoverCandidates(
        (await api.searchCovers(id, coverQuery)).filter(
          (candidate) => candidate.source === 'open_library',
        ),
      );
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSearchingCovers(false);
    }
  }

  async function chooseCover(candidate: { source: string; source_id: string }) {
    setSavingCover(candidate.source_id);
    try {
      await api.selectCover(id, candidate.source, candidate.source_id);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function restoreCover() {
    setSavingCover('restore');
    try {
      await api.restoreCover(id);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function saveCoverSettings() {
    const [focalX, focalY] = coverFocalPoint.split(':').map(Number);
    setSavingCover('settings');
    try {
      await api.updateCoverSettings(id, {
        fit: coverFit,
        focal_x: focalX,
        focal_y: focalY,
        style: generatedStyle,
        tone: Number(generatedTone),
        layout: generatedLayout,
      });
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function deleteCover(coverID: string) {
    setSavingCover(coverID);
    try {
      await api.deleteCover(id, coverID);
      setDeletingCoverID('');
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function uploadCover() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png'] });
    if (result.canceled) return;
    setSavingCover('upload');
    setError('');
    try {
      const asset = result.assets[0];
      const blob = await fetch(asset.uri).then((response) => response.blob());
      await api.uploadCover(id, blob, asset.name);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function deleteWork() {
    setDeletingWork(true);
    try {
      await api.deleteWork(id);
      goBackOr(`/library/${libraryId}`);
    } catch (value) {
      setError(errorMessage(value));
      setDeletingWork(false);
    }
  }

  if (!canEdit)
    return (
      <Page
        title="Manage work"
        back={<Button label="Work" icon="back" kind="quiet" onPress={backToWork} />}
        editorial={false}
      >
        <Notice danger>You don&apos;t have permission to manage this work.</Notice>
      </Page>
    );

  return (
    <Page
      title={`Manage · ${work.title}`}
      back={<Button label="Work" icon="back" kind="quiet" onPress={backToWork} />}
      editorial={false}
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Manage section"
        className="mb-5 flex-row flex-wrap gap-6 border-b border-line"
      >
        {manageTabs.map((tab) => (
          <ManageTabItem
            key={tab.value}
            label={tab.label}
            selected={activeTab === tab.value}
            onPress={() => selectTab(tab.value)}
          />
        ))}
      </View>

      {activeTab === 'cover' ? (
        <View className="gap-8">
          <Section title="Presentation">
            <View className="flex-row flex-wrap items-start gap-6">
              <BookCover
                title={work.title}
                author={work.author}
                coverURL={work.cover_url}
                size="small"
                coverFit={coverFit}
                coverFocalX={Number(coverFocalPoint.split(':')[0])}
                coverFocalY={Number(coverFocalPoint.split(':')[1])}
                generatedCoverStyle={generatedStyle}
                generatedCoverTone={Number(generatedTone)}
                generatedCoverLayout={generatedLayout}
              />
              <View className="min-w-[280px] max-w-[680px] flex-1 gap-5">
                <Text className={shared.itemMeta}>
                  {work.cover_url
                    ? 'Custom artwork is selected.'
                    : 'Using the Aldus-generated cover.'}{' '}
                  One cover is shared by reading and listening; source files are never modified.
                </Text>
                <Select
                  label="Image fit"
                  value={coverFit}
                  options={[
                    { value: 'cover', label: 'Fill frame' },
                    { value: 'contain', label: 'Show full image' },
                  ]}
                  onChange={(value) => setCoverFit(value as 'cover' | 'contain')}
                />
                <Select
                  label="Image focus"
                  value={coverFocalPoint}
                  options={[
                    { value: '50:0', label: 'Top' },
                    { value: '50:50', label: 'Center' },
                    { value: '50:100', label: 'Bottom' },
                    { value: '0:50', label: 'Left' },
                    { value: '100:50', label: 'Right' },
                  ]}
                  onChange={setCoverFocalPoint}
                />
                <View className="self-start">
                  <Button
                    label="Save presentation"
                    kind="primary"
                    loading={savingCover === 'settings'}
                    disabled={Boolean(savingCover)}
                    onPress={() => void saveCoverSettings()}
                  />
                </View>
              </View>
            </View>
          </Section>

          <Section title="Generated cover">
            <Text className={shared.itemMeta}>
              Keep a dependable library-made option even when artwork is missing.
            </Text>
            <Select
              label="Design"
              value={generatedStyle}
              options={[
                { value: 'classic', label: 'Classic' },
                { value: 'minimal', label: 'Minimal' },
                { value: 'framed', label: 'Framed' },
              ]}
              onChange={(value) => setGeneratedStyle(value as 'classic' | 'minimal' | 'framed')}
            />
            <Select
              label="Title position"
              value={generatedLayout}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'center', label: 'Center' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(value) => setGeneratedLayout(value as 'top' | 'center' | 'bottom')}
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
            <Row>
              <Button
                label={work.cover_url ? 'Use generated cover' : 'Generated cover selected'}
                kind="secondary"
                selected={!work.cover_url}
                disabled={Boolean(savingCover) || !work.cover_url}
                onPress={() => void restoreCover()}
              />
              <Button
                label="Save generated design"
                kind="secondary"
                loading={savingCover === 'settings'}
                disabled={Boolean(savingCover)}
                onPress={() => void saveCoverSettings()}
              />
            </Row>
          </Section>

          <Section title="Cover library">
            <Text className={shared.itemMeta}>
              Embedded, uploaded, and previously selected artwork stays available here.
            </Text>
            <View className="self-start">
              <Button
                label={savingCover === 'upload' ? 'Uploading…' : 'Upload an image'}
                icon="add"
                kind="secondary"
                disabled={Boolean(savingCover)}
                onPress={() => void uploadCover()}
              />
            </View>
            {coverAssets.length ? (
              <View className="flex-row flex-wrap items-start gap-5">
                {coverAssets.map((asset) => (
                  <CoverAssetCard
                    key={`${asset.source}-${asset.source_id}`}
                    asset={asset}
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
              <Text className={shared.itemMeta}>No source artwork was found for this Work.</Text>
            )}
          </Section>

          <Section title="Find another edition">
            <Text className={shared.itemMeta}>Search Open Library by title, author, or ISBN.</Text>
            <SearchField label="Search terms" value={coverQuery} onChangeText={setCoverQuery} />
            <View className="self-start">
              <Button
                label={searchingCovers ? 'Searching…' : 'Search Open Library'}
                icon="search"
                kind="primary"
                disabled={searchingCovers || !coverQuery.trim()}
                onPress={() => void searchCovers()}
              />
            </View>
            {coverCandidates.length ? (
              <View className="flex-row flex-wrap items-start gap-5">
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
                Results include edition details so you can avoid film tie-in artwork.
              </Text>
            ) : null}
          </Section>
        </View>
      ) : null}

      {activeTab === 'representations' ? (
        <View className="gap-8">
          <Section title="Manage representations">
            {representations.length === 0 ? (
              <EmptyState icon="folder" title="No representations yet">
                Add an EPUB or audio representation below to start building this Work.
              </EmptyState>
            ) : (
              representations.map((item) => {
                const revisions = media.filter(
                  (revision) => revision.representation_id === item.id,
                );
                return (
                  <Pressable
                    accessibilityRole="link"
                    key={item.id}
                    className={shared.listItem}
                    onPress={() =>
                      router.push(`/representation/${item.id}?libraryId=${libraryId}&role=${role}`)
                    }
                  >
                    <Text className={shared.itemTitle}>{item.label}</Text>
                    <Text className={shared.itemMeta}>
                      {item.kind} · {revisions.length} immutable revision
                      {revisions.length === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </Section>
          <Section title="Add representation">
            <View className={shared.form}>
              <Select label="Kind" options={representationKinds} value={kind} onChange={setKind} />
              <Field
                label="Label"
                value={label}
                onChangeText={setLabel}
                placeholder="Narrated by… or 2026 EPUB"
              />
              <View className="self-start">
                <Button
                  label="Create representation"
                  kind="primary"
                  disabled={!kind.trim() || !label.trim()}
                  onPress={createRepresentation}
                />
              </View>
            </View>
          </Section>
        </View>
      ) : null}

      {activeTab === 'alignment' ? (
        <Section title="Alignment management">
          <Notice>
            Alignment matches exact EPUB and audiobook revisions word-for-word, so readers can jump
            between reading and listening at the same point. Pick one revision of each below.
          </Notice>
          <View className={shared.split}>
            <RevisionChoiceList
              title="EPUB revision"
              items={epubs}
              selected={epubID}
              onSelect={setEPUBID}
            />
            <RevisionChoiceList
              title="Audiobook revision"
              items={audio}
              selected={audioID}
              onSelect={setAudioID}
            />
          </View>
          <View className="items-start gap-2">
            <Button
              label="Start alignment"
              kind="primary"
              disabled={!selectedEPUB || !selectedAudio}
              onPress={enqueue}
            />
            <Text className={shared.itemMeta}>
              Runs on the server — you can leave this page and check back later.
            </Text>
          </View>
          {jobs.length === 0 ? (
            <EmptyState icon="synced" title="No alignment jobs">
              Start alignment above once an EPUB and audiobook revision are selected.
            </EmptyState>
          ) : (
            jobs.map((job) => {
              const epubMedia = media.find((item) => item.id === job.epub_media_id);
              const audioMedia = media.find((item) => item.id === job.audio_media_id);
              return (
                <View key={job.id} className={shared.listItem}>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <StatusBadge tone={alignmentJobTone(job.state)} label={job.state} />
                    <Text className={shared.itemMeta}>
                      {new Date(job.created_at).toLocaleString()}
                    </Text>
                  </View>
                  <Text className={shared.itemTitle}>
                    {epubMedia?.original_filename || epubMedia?.representation.label || 'EPUB'}
                    {' + '}
                    {audioMedia?.original_filename ||
                      audioMedia?.representation.label ||
                      'Audiobook'}
                  </Text>
                  <Text className={shared.itemMeta}>
                    {alignmentJobHint(job.state)}
                    {job.error ? ` (${job.error})` : ''}
                  </Text>
                  <TechnicalDetails
                    rows={[
                      { label: 'Job ID', value: job.id, copyable: true },
                      { label: 'EPUB media ID', value: job.epub_media_id, copyable: true },
                      { label: 'Audio media ID', value: job.audio_media_id, copyable: true },
                      ...(job.alignment_id
                        ? [{ label: 'Alignment ID', value: job.alignment_id, copyable: true }]
                        : []),
                    ]}
                  />
                  {!terminal.has(job.state) ? (
                    <View className="self-start">
                      <Button label="Cancel" kind="danger" onPress={() => void cancelJob(job.id)} />
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </Section>
      ) : null}

      {activeTab === 'settings' ? (
        <Section title="Work settings">
          <View className={shared.form}>
            <Field label="Title" value={title} onChangeText={setTitle} />
            <Field label="Author" value={author} onChangeText={setAuthor} />
            <View className="self-start">
              <Button label="Save" kind="primary" onPress={() => void saveWorkSettings()} />
            </View>
            <View className="mt-4 gap-2 border-t border-line pt-4">
              <Text className="text-sm font-extrabold text-ink">Delete work</Text>
              <Text className={shared.itemMeta}>
                The work must have no representations before it can be deleted.
              </Text>
              <View className="self-start">
                <Button
                  label="Delete work"
                  kind="danger"
                  onPress={() => setConfirmingDelete(true)}
                />
              </View>
            </View>
          </View>
        </Section>
      ) : null}

      <ConfirmDialog
        visible={Boolean(deletingCoverID)}
        onClose={() => setDeletingCoverID('')}
        onConfirm={() => void deleteCover(deletingCoverID)}
        title="Delete uploaded cover?"
        description="The image will be removed from Aldus. Your EPUB and audiobook files are unaffected."
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

/** Flat underline tab, not a bordered button — matches the mobile tab bar's treatment (color, not a box). */
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
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 items-center justify-center border-b-2 px-1 pb-3 ${borderClass} ${opacityClass}`}
    >
      <Text className={`text-sm font-bold ${textClass}`}>{label}</Text>
    </Pressable>
  );
}

/** One tappable cover search result — the whole card is the target, not a bordered button underneath it. */
function CoverAssetCard({
  asset,
  work,
  disabled,
  selecting,
  onSelect,
  onDelete,
}: {
  asset: CoverAsset;
  work: Work;
  disabled: boolean;
  selecting: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <View className={`w-[148px] gap-2 ${disabled && !selecting ? 'opacity-50' : ''}`}>
      <BookCover
        title={work.title}
        author={work.author}
        coverURL={asset.image_url}
        size="small"
        {...coverPresentation(work)}
      />
      <Text numberOfLines={1} className="text-sm font-bold text-ink">
        {asset.label}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted">
        {asset.source === 'embedded'
          ? 'From source media'
          : asset.source === 'upload'
            ? 'Added to Aldus'
            : 'Open Library'}
      </Text>
      <Button
        label={asset.selected ? 'Selected' : selecting ? 'Selecting…' : 'Use cover'}
        kind="secondary"
        selected={asset.selected}
        disabled={disabled || asset.selected}
        onPress={onSelect}
      />
      {onDelete ? (
        <Button label="Delete upload" kind="danger" disabled={disabled} onPress={onDelete} />
      ) : null}
    </View>
  );
}

function CoverCandidateCard({
  candidate,
  fallbackTitle,
  fallbackAuthor,
  selecting,
  disabled,
  onPress,
}: {
  candidate: CoverCandidate;
  fallbackTitle: string;
  fallbackAuthor?: string;
  selecting: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const title = candidate.title || fallbackTitle;
  const meta =
    [candidate.publisher, candidate.first_publish_year || undefined].filter(Boolean).join(' · ') ||
    (candidate.source === 'embedded' ? 'Embedded artwork' : 'Open Library');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use this cover: ${title}, ${meta}`}
      accessibilityState={{ disabled, busy: selecting }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`w-[148px] gap-2 rounded-control ${stateClass} ${disabled && !selecting ? 'opacity-50' : ''}`}
    >
      <BookCover
        title={title}
        author={candidate.author || fallbackAuthor}
        coverURL={candidate.image_url}
        size="small"
        coverFit="cover"
      />
      <Text numberOfLines={2} className="font-editorial text-sm font-bold text-ink">
        {title}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted">
        {meta}
      </Text>
      <Text className="text-xs font-bold text-accent">
        {selecting ? 'Selecting…' : 'Use this cover'}
      </Text>
    </Pressable>
  );
}

async function loadRevisions(libraryId: string, representations: Representation[]) {
  const grouped = await Promise.all(
    representations.map(async (representation) =>
      (await api.media(libraryId, representation.id)).map((item) => ({
        ...item,
        representation,
      })),
    ),
  );
  return grouped.flat();
}

function RevisionChoiceList({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: MediaChoice[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View className={shared.grow}>
      <Text className={shared.itemTitle}>{title}</Text>
      {items.length === 0 ? (
        <Empty>None available.</Empty>
      ) : (
        items.map((item) => {
          const checked = selected === item.id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              key={item.id}
              className="min-h-11 flex-row items-start gap-3 border-b border-line py-3.5"
              onPress={() => onSelect(item.id)}
            >
              <View
                className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border bg-paper ${checked ? 'border-accent' : 'border-line'}`}
              >
                {checked ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className={shared.itemTitle}>
                  {item.original_filename || item.representation.label}
                </Text>
                <Text className={shared.itemMeta}>
                  {formatBytes(item.size_bytes)} · {item.representation.label}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
