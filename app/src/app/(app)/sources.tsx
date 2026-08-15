import type {
  ImportProposal,
  Library,
  LibrarySource,
  Representation,
  Work,
} from '../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  canManageSources,
  makeReviewDraft,
  mergeReviewDraft,
  type ReviewDraft,
} from '../../features/source-administration';
import { AddSourceDialog } from '../../features/sources/AddSourceDialog';
import { ImportReviewSection } from '../../features/sources/ImportReviewSection';
import { ReviewDialog } from '../../features/sources/ReviewDialog';
import { SourceCard } from '../../features/sources/SourceCard';
import type { SourceDetails } from '../../features/sources/types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Loading,
  Notice,
  Page,
  Section,
} from '../../features/ui';
import { Pressable, Text, View } from '../../features/tw';
import { APIError, api, errorMessage } from '../../lib/api';

export default function SourcesAdministration() {
  const { libraryId } = useLocalSearchParams<{ libraryId?: string }>();
  const auth = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryID, setSelectedLibraryID] = useState(libraryId ?? '');
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [details, setDetails] = useState<Record<string, SourceDetails>>({});
  const [proposals, setProposals] = useState<ImportProposal[]>([]);
  const [works, setWorks] = useState<Work[]>([]);
  const [representations, setRepresentations] = useState<Representation[]>([]);
  const [expandedSourceID, setExpandedSourceID] = useState('');
  const [editingSource, setEditingSource] = useState<LibrarySource | 'new' | null>(null);
  const [review, setReview] = useState<ImportProposal>();
  const [draft, setDraft] = useState<ReviewDraft>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState('');
  const [removeSourceTarget, setRemoveSourceTarget] = useState<LibrarySource | null>(null);
  const [ignoreProposalTarget, setIgnoreProposalTarget] = useState<ImportProposal | null>(null);

  const selectedLibrary = libraries.find((library) => library.id === selectedLibraryID);
  const canAdminister = canManageSources(Boolean(auth.user?.admin), selectedLibrary);
  const activeScan = useMemo(
    () =>
      Object.values(details).some(({ scans }) => ['pending', 'scanning'].includes(scans[0]?.state)),
    [details],
  );

  async function loadLibraries() {
    try {
      const available = (await api.libraries()).filter(
        (library) => auth.user?.admin || library.role === 'owner' || library.role === 'editor',
      );
      setLibraries(available);
      setSelectedLibraryID((current) =>
        available.some((library) => library.id === current) ? current : (available[0]?.id ?? ''),
      );
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  async function loadAdministration(showLoading = false) {
    if (!selectedLibraryID || !canAdminister) return;
    if (showLoading) setLoading(true);
    try {
      const [nextSources, nextProposals, nextWorks] = await Promise.all([
        api.sources(selectedLibraryID),
        api.importProposals(selectedLibraryID),
        api.works(selectedLibraryID),
      ]);
      const nextDetails = await Promise.all(
        nextSources.map(async (source) => {
          const [scans, entries] = await Promise.all([
            api.sourceScans(selectedLibraryID, source.id),
            api.sourceEntries(selectedLibraryID, source.id),
          ]);
          return [source.id, { scans, entries }] as const;
        }),
      );
      setSources(nextSources);
      setProposals(nextProposals);
      setWorks(nextWorks);
      setDetails(Object.fromEntries(nextDetails));
      setError('');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    // Data loading is the external synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLibraries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAdministration(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLibraryID, canAdminister]);

  useEffect(() => {
    if (!activeScan) return;
    const timer = setInterval(() => void loadAdministration(), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScan, selectedLibraryID]);

  function openNewSource() {
    setEditingSource('new');
  }

  function openEditSource(source: LibrarySource) {
    setEditingSource(source);
  }

  async function submitSource(payload: { name: string; rootPath: string }) {
    if (!selectedLibraryID) return;
    setBusy(true);
    try {
      if (editingSource === 'new') {
        const created = await api.createSource(selectedLibraryID, {
          name: payload.name,
          root_path: payload.rootPath,
        });
        setEditingSource(null);
        await loadAdministration();
        try {
          // Kick off the first scan immediately so the source never sits in
          // a stale "never scanned" state waiting for the admin to notice.
          await api.startSourceScan(selectedLibraryID, created.id);
          await loadAdministration();
        } catch {
          // Creation already succeeded; the source card's own "Scan now"
          // action remains available if the automatic scan couldn't start.
        }
      } else if (editingSource) {
        await api.updateSource(selectedLibraryID, editingSource.id, {
          name: payload.name,
          root_path: payload.rootPath,
          enabled: editingSource.enabled,
        });
        setEditingSource(null);
        await loadAdministration();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleSource(source: LibrarySource) {
    setBusy(true);
    try {
      await api.updateSource(selectedLibraryID, source.id, {
        name: source.name,
        root_path: source.root_path,
        enabled: !source.enabled,
      });
      await loadAdministration();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function removeSource(source: LibrarySource) {
    setBusy(true);
    try {
      await api.deleteSource(selectedLibraryID, source.id);
      setRemoveSourceTarget(null);
      await loadAdministration();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function scanSource(source: LibrarySource) {
    setBusy(true);
    try {
      await api.startSourceScan(selectedLibraryID, source.id);
      await loadAdministration();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function openReview(proposal: ImportProposal) {
    setConflict('');
    setReview(proposal);
    setDraft(makeReviewDraft(proposal));
    try {
      setRepresentations(
        proposal.existing_work_id ? await api.representations(proposal.existing_work_id) : [],
      );
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function chooseWork(workID: string) {
    setDraft((current) => (current ? { ...current, workID } : current));
    if (!workID) {
      setRepresentations([]);
      return;
    }
    try {
      setRepresentations(await api.representations(workID));
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function updateReviewItem(
    entryID: string,
    key: 'kind' | 'label' | 'representationID',
    value: string,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: {
              ...current.items,
              [entryID]: { ...current.items[entryID], [key]: value },
            },
          }
        : current,
    );
  }

  async function refreshConflictedProposal(proposal: ImportProposal) {
    const latest = await api.importProposal(selectedLibraryID, proposal.id);
    setReview(latest);
    setDraft((current) => mergeReviewDraft(latest, current));
    setConflict(
      'This proposal changed during review. It has been refreshed; please check your choices.',
    );
    await loadAdministration();
  }

  async function acceptProposal() {
    if (!review || !draft) return;
    setBusy(true);
    setConflict('');
    try {
      await api.acceptImportProposal(selectedLibraryID, review.id, {
        expected_revision: review.revision,
        work_id: draft.workID,
        title: draft.title,
        author: draft.author,
        items: review.items.map((item) => ({
          source_entry_id: item.source_entry_id,
          kind: draft.items[item.source_entry_id].kind,
          label: draft.items[item.source_entry_id].label,
          representation_id: draft.items[item.source_entry_id].representationID,
        })),
      });
      setReview(undefined);
      setDraft(undefined);
      await loadAdministration();
    } catch (value) {
      if (value instanceof APIError && value.status === 409) {
        try {
          await refreshConflictedProposal(review);
        } catch {
          setReview(undefined);
          setDraft(undefined);
          setError(
            'The proposal changed and is no longer available. The inbox has been refreshed.',
          );
          await loadAdministration();
        }
      } else {
        setError(errorMessage(value));
      }
    } finally {
      setBusy(false);
    }
  }

  async function ignoreProposal(proposal: ImportProposal) {
    setBusy(true);
    try {
      await api.ignoreImportProposal(selectedLibraryID, proposal.id, proposal.revision);
      if (review?.id === proposal.id) setReview(undefined);
      setIgnoreProposalTarget(null);
      await loadAdministration();
    } catch (value) {
      if (value instanceof APIError && value.status === 409) {
        setError('The proposal changed before it could be ignored. The inbox has been refreshed.');
        await loadAdministration();
      } else {
        setError(errorMessage(value));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading label="Loading source administration…" />;

  return (
    <Page
      title="Sources & imports"
      actions={
        selectedLibrary ? (
          <Button
            label="View library"
            kind="quiet"
            onPress={() => router.push(`/library/${selectedLibrary.id}`)}
          />
        ) : undefined
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}

      {libraries.length === 0 ? (
        <Notice>You do not manage any libraries.</Notice>
      ) : (
        <LibraryTabs
          libraries={libraries}
          selectedLibraryID={selectedLibraryID}
          onSelect={setSelectedLibraryID}
        />
      )}

      {selectedLibrary && canAdminister ? (
        <>
          <View className="max-w-[760px] gap-1">
            <Text className="text-sm text-muted">
              You&rsquo;re viewing sources for{' '}
              <Text className="font-extrabold text-ink">{selectedLibrary.name}</Text>
            </Text>
            <Text className="text-sm text-muted">
              Sources supply externally owned files. Imported Works remain part of the Library, even
              when their files come from more than one Source.
            </Text>
          </View>

          <Section
            title="Library sources"
            action={
              auth.user?.admin ? (
                <Button label="Add source" icon="add" kind="secondary" onPress={openNewSource} />
              ) : undefined
            }
          >
            {sources.length === 0 ? (
              <EmptyState icon="folder" title="No sources configured">
                Add a Source to let Aldus discover books and audiobooks in a folder you own.
              </EmptyState>
            ) : (
              <View className="flex-row flex-wrap items-start gap-4">
                {sources.map((source) => (
                  <SourceCard
                    admin={Boolean(auth.user?.admin)}
                    busy={busy}
                    details={details[source.id]}
                    expanded={expandedSourceID === source.id}
                    key={source.id}
                    source={source}
                    onEdit={() => openEditSource(source)}
                    onRemove={() => setRemoveSourceTarget(source)}
                    onScan={() => void scanSource(source)}
                    onToggle={() => void toggleSource(source)}
                    onToggleEntries={() =>
                      setExpandedSourceID((current) => (current === source.id ? '' : source.id))
                    }
                  />
                ))}
              </View>
            )}
          </Section>

          <ImportReviewSection
            proposals={proposals}
            works={works}
            onIgnore={setIgnoreProposalTarget}
            onReview={(proposal) => void openReview(proposal)}
          />
        </>
      ) : selectedLibrary ? (
        <Notice danger>You do not have permission to manage this Library.</Notice>
      ) : null}

      <AddSourceDialog
        visible={Boolean(editingSource)}
        mode={editingSource === 'new' ? 'create' : 'edit'}
        source={editingSource && editingSource !== 'new' ? editingSource : undefined}
        busy={busy}
        onClose={() => setEditingSource(null)}
        onSubmit={submitSource}
      />

      <ReviewDialog
        busy={busy}
        conflict={conflict}
        draft={draft}
        proposal={review}
        representations={representations}
        works={works}
        onAccept={() => void acceptProposal()}
        onChooseWork={(workID) => void chooseWork(workID)}
        onClose={() => setReview(undefined)}
        onDraftChange={setDraft}
        onIgnore={() => review && setIgnoreProposalTarget(review)}
        onItemChange={updateReviewItem}
      />

      <ConfirmDialog
        visible={Boolean(removeSourceTarget)}
        onClose={() => setRemoveSourceTarget(null)}
        onConfirm={() => removeSourceTarget && void removeSource(removeSourceTarget)}
        title={`Remove ${removeSourceTarget?.name}?`}
        description="Imported Works stay in the Library. Files available only through this Source will become unavailable."
        confirmLabel="Remove source"
        danger
        busy={busy}
      />

      <ConfirmDialog
        visible={Boolean(ignoreProposalTarget)}
        onClose={() => setIgnoreProposalTarget(null)}
        onConfirm={() => ignoreProposalTarget && void ignoreProposal(ignoreProposalTarget)}
        title="Ignore this proposal?"
        description="It will leave the review inbox."
        confirmLabel="Ignore"
        danger
        busy={busy}
      />
    </Page>
  );
}

/**
 * The single "which Library am I looking at" control on this page. Arriving
 * from a Library's own "Sources & imports" link pre-selects a tab here;
 * arriving from the standalone Sources nav link defaults to the first
 * Library. Either way this tab row — plus the plain-language line under it —
 * is the only place selection is indicated, so there is never a second,
 * redundant "which Library" control on screen.
 */
function LibraryTabs({
  libraries,
  selectedLibraryID,
  onSelect,
}: {
  libraries: Library[];
  selectedLibraryID: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2">
      {libraries.map((library) => {
        const selected = library.id === selectedLibraryID;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={library.id}
            onPress={() => onSelect(library.id)}
            className={`min-h-11 justify-center rounded-control border px-3.5 ${
              selected ? 'border-ink bg-ink' : 'border-line bg-paper'
            }`}
          >
            <Text className={`text-sm font-extrabold ${selected ? 'text-paper' : 'text-ink'}`}>
              {library.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
