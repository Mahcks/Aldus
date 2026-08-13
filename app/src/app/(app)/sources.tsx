import type {
  ImportProposal,
  Library,
  LibrarySource,
  Representation,
  SourceEntry,
  SourceDirectoryListing,
  SourceRoot,
  SourceScan,
  Work,
} from '../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { AppIcon } from '../../features/icons';
import {
  canManageSources,
  childDirectory,
  makeReviewDraft,
  mergeReviewDraft,
  parentDirectory,
  type ReviewDraft,
} from '../../features/source-administration';
import {
  Button,
  Empty,
  EmptyState,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  colors,
  shared,
} from '../../features/ui';
import { APIError, api, errorMessage } from '../../lib/api';

type SourceDetails = {
  scans: SourceScan[];
  entries: SourceEntry[];
};

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
  const [sourceName, setSourceName] = useState('');
  const [sourceRoot, setSourceRoot] = useState('');
  const [availableRoots, setAvailableRoots] = useState<SourceRoot[]>([]);
  const [directory, setDirectory] = useState<SourceDirectoryListing>();
  const [pickerError, setPickerError] = useState('');
  const [review, setReview] = useState<ImportProposal>();
  const [draft, setDraft] = useState<ReviewDraft>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState('');

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

  async function openNewSource() {
    setSourceName('');
    setSourceRoot('');
    setEditingSource('new');
    setPickerError('');
    try {
      const roots = await api.sourceRoots();
      setAvailableRoots(roots);
      if (roots[0]) await openDirectory(roots[0].id);
      else setDirectory(undefined);
    } catch (value) {
      setPickerError(errorMessage(value));
    }
  }

  function openEditSource(source: LibrarySource) {
    setSourceName(source.name);
    setSourceRoot(source.root_path);
    setEditingSource(source);
  }

  async function openDirectory(rootID: string, path = '') {
    try {
      const listing = await api.sourceDirectories(rootID, path);
      setDirectory(listing);
      setSourceRoot(listing.selected_path);
      setPickerError('');
    } catch (value) {
      setPickerError(errorMessage(value));
    }
  }

  async function saveSource() {
    if (!selectedLibraryID || !editingSource) return;
    setBusy(true);
    try {
      if (editingSource === 'new') {
        await api.createSource(selectedLibraryID, { name: sourceName, root_path: sourceRoot });
      } else {
        await api.updateSource(selectedLibraryID, editingSource.id, {
          name: sourceName,
          root_path: sourceRoot,
          enabled: editingSource.enabled,
        });
      }
      setEditingSource(null);
      await loadAdministration();
    } catch (value) {
      setPickerError(errorMessage(value));
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

  function confirmRemoveSource(source: LibrarySource) {
    Alert.alert(
      `Remove ${source.name}?`,
      'Imported Works stay in the Library. Files available only through this Source will become unavailable.',
      [
        { text: 'Cancel' },
        {
          text: 'Remove source',
          style: 'destructive',
          onPress: () => void removeSource(source),
        },
      ],
    );
  }

  async function removeSource(source: LibrarySource) {
    setBusy(true);
    try {
      await api.deleteSource(selectedLibraryID, source.id);
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

  function confirmIgnoreProposal(proposal: ImportProposal) {
    Alert.alert('Ignore this proposal?', 'It will leave the review inbox.', [
      { text: 'Cancel' },
      {
        text: 'Ignore',
        style: 'destructive',
        onPress: () => void ignoreProposal(proposal),
      },
    ]);
  }

  async function ignoreProposal(proposal: ImportProposal) {
    setBusy(true);
    try {
      await api.ignoreImportProposal(selectedLibraryID, proposal.id, proposal.revision);
      if (review?.id === proposal.id) setReview(undefined);
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
        <Row>
          {selectedLibrary ? (
            <Button
              label="View library"
              kind="quiet"
              onPress={() => router.push(`/library/${selectedLibrary.id}`)}
            />
          ) : null}
          {auth.user?.admin && selectedLibrary ? (
            <Button
              label="Add source"
              icon="add"
              kind="primary"
              onPress={() => void openNewSource()}
            />
          ) : null}
        </Row>
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      {libraries.length === 0 ? (
        <Notice>You do not manage any libraries.</Notice>
      ) : (
        <View accessibilityRole="tablist" style={styles.libraryTabs}>
          {libraries.map((library) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: library.id === selectedLibraryID }}
              key={library.id}
              onPress={() => setSelectedLibraryID(library.id)}
              style={[
                styles.libraryTab,
                library.id === selectedLibraryID && styles.libraryTabSelected,
              ]}
            >
              <Text
                style={[
                  styles.libraryTabText,
                  library.id === selectedLibraryID && styles.libraryTabTextSelected,
                ]}
              >
                {library.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {selectedLibrary && canAdminister ? (
        <>
          <View style={styles.relationship}>
            <Text style={styles.eyebrow}>Library</Text>
            <Text style={styles.relationshipTitle}>{selectedLibrary.name}</Text>
            <Text style={shared.itemMeta}>
              Sources supply externally owned files. Imported Works remain part of the Library, even
              when their files come from more than one Source.
            </Text>
          </View>

          <Section
            title="Library sources"
            action={
              auth.user?.admin ? (
                <Button
                  label="Add source"
                  icon="add"
                  kind="secondary"
                  onPress={() => void openNewSource()}
                />
              ) : undefined
            }
          >
            {sources.length === 0 ? (
              <Empty>No sources configured for this Library.</Empty>
            ) : (
              <View style={styles.cardGrid}>
                {sources.map((source) => (
                  <SourceCard
                    admin={Boolean(auth.user?.admin)}
                    busy={busy}
                    details={details[source.id]}
                    expanded={expandedSourceID === source.id}
                    key={source.id}
                    source={source}
                    onEdit={() => openEditSource(source)}
                    onRemove={() => confirmRemoveSource(source)}
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

          <Section title={`Import review · ${proposals.length}`}>
            {proposals.length === 0 ? (
              <EmptyState icon="check" title="Inbox clear">
                New and ambiguous discoveries will appear here after a scan.
              </EmptyState>
            ) : (
              <View style={styles.proposalList}>
                {proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    suggestedWork={works.find((work) => work.id === proposal.existing_work_id)}
                    onIgnore={() => confirmIgnoreProposal(proposal)}
                    onReview={() => void openReview(proposal)}
                  />
                ))}
              </View>
            )}
          </Section>
        </>
      ) : selectedLibrary ? (
        <Notice danger>You do not have permission to manage this Library.</Notice>
      ) : null}

      <SourceDialog
        busy={busy}
        roots={availableRoots}
        directory={directory}
        pickerError={pickerError}
        editing={editingSource}
        name={sourceName}
        root={sourceRoot}
        onClose={() => setEditingSource(null)}
        onNameChange={setSourceName}
        onRootChange={setSourceRoot}
        onOpenDirectory={(rootID, path) => void openDirectory(rootID, path)}
        onSave={() => void saveSource()}
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
        onIgnore={() => review && confirmIgnoreProposal(review)}
        onItemChange={updateReviewItem}
      />
    </Page>
  );
}

function SourceCard({
  source,
  details,
  admin,
  busy,
  expanded,
  onScan,
  onEdit,
  onToggle,
  onRemove,
  onToggleEntries,
}: {
  source: LibrarySource;
  details?: SourceDetails;
  admin: boolean;
  busy: boolean;
  expanded: boolean;
  onScan: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onToggleEntries: () => void;
}) {
  const latest = details?.scans[0];
  const active = latest && ['pending', 'scanning'].includes(latest.state);
  const health = !source.enabled
    ? 'disabled'
    : latest?.state === 'failed'
      ? 'unavailable'
      : 'available';
  return (
    <View style={styles.sourceCard}>
      <View style={styles.cardHeader}>
        <View style={styles.grow}>
          <Text style={styles.cardTitle}>{source.name}</Text>
          <Text style={shared.itemMeta}>
            Local filesystem · {source.enabled ? 'Enabled' : 'Disabled'}
          </Text>
        </View>
        <StatePill state={health} />
      </View>
      {admin && source.root_path ? <Text style={shared.mono}>{source.root_path}</Text> : null}
      {latest ? <ScanSummary scan={latest} /> : <Text style={shared.itemMeta}>Never scanned</Text>}
      <Row>
        <Button
          label={active ? 'Scan in progress…' : 'Scan now'}
          icon="scan"
          kind="primary"
          disabled={busy || !source.enabled || Boolean(active)}
          onPress={onScan}
        />
        <Button
          label={`${expanded ? 'Hide' : 'Inspect'} files (${details?.entries.length ?? 0})`}
          onPress={onToggleEntries}
        />
        {admin ? <Button label="Edit" icon="edit" kind="quiet" onPress={onEdit} /> : null}
      </Row>
      {admin ? (
        <Row>
          <Button
            label={source.enabled ? 'Disable' : 'Enable'}
            kind="quiet"
            disabled={busy}
            onPress={onToggle}
          />
          <Button
            label="Remove"
            icon="delete"
            kind="danger"
            disabled={busy || Boolean(active)}
            onPress={onRemove}
          />
        </Row>
      ) : null}
      {expanded ? (
        <>
          <ScanHistory scans={details?.scans.slice(1, 6) ?? []} />
          <EntryList entries={details?.entries ?? []} />
        </>
      ) : null}
    </View>
  );
}

function ScanSummary({ scan }: { scan: SourceScan }) {
  const date = scan.finished_at ?? scan.started_at ?? scan.created_at;
  return (
    <View style={styles.scanSummary}>
      <View style={styles.scanTitleRow}>
        <StatePill state={scan.state} />
        <Text style={shared.itemMeta}>{formatDate(date)}</Text>
      </View>
      <View style={styles.countGrid}>
        <Count label="Discovered" value={scan.supported} />
        <Count label="New" value={scan.new} />
        <Count label="Changed" value={scan.changed} />
        <Count label="Unchanged" value={scan.unchanged} />
        <Count label="Missing" value={scan.missing} />
        <Count label="Problems" value={scan.problems} danger={scan.problems > 0} />
      </View>
      {scan.error ? <Notice danger>{scan.error}</Notice> : null}
    </View>
  );
}

function ScanHistory({ scans }: { scans: SourceScan[] }) {
  if (scans.length === 0) return null;
  return (
    <View style={styles.history}>
      <Text style={styles.subheading}>Recent scans</Text>
      {scans.map((scan) => (
        <View key={scan.id} style={styles.historyRow}>
          <StatePill state={scan.state} />
          <Text style={shared.itemMeta}>
            {formatDate(scan.finished_at ?? scan.started_at ?? scan.created_at)} · {scan.supported}{' '}
            discovered · {scan.problems} problems
          </Text>
        </View>
      ))}
    </View>
  );
}

function Count({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, danger && styles.dangerText]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function EntryList({ entries }: { entries: SourceEntry[] }) {
  if (entries.length === 0) return <Empty>No discovered files yet.</Empty>;
  return (
    <View style={styles.entryList}>
      <Text style={styles.subheading}>Discovered files</Text>
      {entries.map((entry) => {
        const title = metadataText(entry, 'title');
        const author = metadataText(entry, 'author') || metadataText(entry, 'artist');
        const extra = [metadataText(entry, 'narrator'), metadataText(entry, 'series')]
          .filter(Boolean)
          .join(' · ');
        return (
          <View key={entry.id} style={styles.entry}>
            <View style={styles.cardHeader}>
              <Text selectable style={styles.entryPath}>
                {entry.relative_path}
              </Text>
              <StatePill state={entry.state} />
            </View>
            <Text style={shared.itemMeta}>
              {entry.kind || 'Unknown format'} · {formatBytes(entry.size_bytes)}
            </Text>
            {title || author ? (
              <Text style={shared.itemMeta}>{[title, author].filter(Boolean).join(' — ')}</Text>
            ) : null}
            {extra ? <Text style={shared.itemMeta}>{extra}</Text> : null}
            {entry.sha256 ? <Text style={shared.mono}>SHA-256 {entry.sha256}</Text> : null}
            {entry.error ? <Notice danger>{entry.error}</Notice> : null}
          </View>
        );
      })}
    </View>
  );
}

function ProposalCard({
  proposal,
  suggestedWork,
  onReview,
  onIgnore,
}: {
  proposal: ImportProposal;
  suggestedWork?: Work;
  onReview: () => void;
  onIgnore: () => void;
}) {
  const kinds = [...new Set(proposal.items.map((item) => item.kind))].join(' + ');
  return (
    <View style={[styles.proposalCard, proposal.state === 'review_required' && styles.needsReview]}>
      <View style={styles.cardHeader}>
        <View style={styles.grow}>
          <Text style={styles.cardTitle}>{proposal.title || 'Untitled discovery'}</Text>
          <Text style={shared.itemMeta}>{proposal.author || 'Unknown author'}</Text>
        </View>
        <StatePill state={proposal.state} />
      </View>
      <Text style={styles.proposalMeta}>
        {proposal.confidence} confidence · {proposal.items.length}{' '}
        {proposal.items.length === 1 ? 'file' : 'files'} · {kinds || 'Unknown format'}
      </Text>
      {proposal.reasons.slice(0, 2).map((reason) => (
        <Text key={reason} style={shared.itemMeta}>
          • {reason}
        </Text>
      ))}
      {suggestedWork ? (
        <Text style={styles.suggestion}>Suggested existing Work: {suggestedWork.title}</Text>
      ) : null}
      <Row>
        <Button label="Review proposal" icon="import" kind="primary" onPress={onReview} />
        <Button label="Ignore" kind="quiet" onPress={onIgnore} />
      </Row>
    </View>
  );
}

function SourceDialog({
  editing,
  name,
  root,
  roots,
  directory,
  pickerError,
  busy,
  onNameChange,
  onRootChange,
  onOpenDirectory,
  onSave,
  onClose,
}: {
  editing: LibrarySource | 'new' | null;
  name: string;
  root: string;
  roots: SourceRoot[];
  directory?: SourceDirectoryListing;
  pickerError: string;
  busy: boolean;
  onNameChange: (value: string) => void;
  onRootChange: (value: string) => void;
  onOpenDirectory: (rootID: string, path?: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const creating = editing === 'new';
  const parent = parentDirectory(directory?.relative_path ?? '');
  return (
    <Dialog
      visible={Boolean(editing)}
      title={editing === 'new' ? 'Add local source' : 'Edit source'}
      onClose={onClose}
    >
      <View style={shared.form}>
        <Field label="Source name" autoFocus value={name} onChangeText={onNameChange} />
        {creating ? (
          roots.length === 0 ? (
            <View style={styles.noRoots}>
              <AppIcon name="folder" size={30} color={colors.accent} />
              <Text style={styles.subheading}>No media folders are available to Aldus</Text>
              <Text style={shared.itemMeta}>
                Mount a host or NAS folder read-only in the Aldus server, then add its
                server-visible path to ALDUS_SOURCE_ROOTS and restart Aldus.
              </Text>
            </View>
          ) : (
            <View style={styles.folderPicker}>
              <Text style={styles.subheading}>Location</Text>
              <View accessibilityRole="tablist" style={styles.rootChoices}>
                {roots.map((available) => (
                  <Button
                    key={available.id}
                    label={available.label}
                    icon="folder"
                    kind={directory?.root_id === available.id ? 'primary' : 'secondary'}
                    selected={directory?.root_id === available.id}
                    onPress={() => onOpenDirectory(available.id)}
                  />
                ))}
              </View>
              {directory ? (
                <>
                  <View style={styles.folderLocation}>
                    <AppIcon name="folder" size={18} color={colors.accent} />
                    <Text selectable style={styles.folderPath}>
                      {roots.find((item) => item.id === directory.root_id)?.label}
                      {directory.relative_path ? ` / ${directory.relative_path}` : ''}
                    </Text>
                  </View>
                  <ScrollView style={styles.folderList}>
                    {directory.has_parent ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open parent folder"
                        onPress={() => onOpenDirectory(directory.root_id, parent)}
                        style={styles.folderRow}
                      >
                        <AppIcon name="back" size={19} color={colors.muted} />
                        <Text style={styles.folderName}>Parent folder</Text>
                      </Pressable>
                    ) : null}
                    {directory.directories.map((folder) => {
                      const path = childDirectory(directory.relative_path, folder);
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${folder}`}
                          key={folder}
                          onPress={() => onOpenDirectory(directory.root_id, path)}
                          style={styles.folderRow}
                        >
                          <AppIcon name="folder" size={20} color={colors.warning} />
                          <Text style={styles.folderName}>{folder}</Text>
                          <AppIcon name="chevron" size={18} color={colors.muted} />
                        </Pressable>
                      );
                    })}
                    {directory.directories.length === 0 ? (
                      <Text style={shared.itemMeta}>
                        No child folders. You can use this folder.
                      </Text>
                    ) : null}
                  </ScrollView>
                </>
              ) : null}
            </View>
          )
        ) : (
          <Field
            label="Server-visible source path"
            autoCapitalize="none"
            autoCorrect={false}
            value={root}
            onChangeText={onRootChange}
            help="This existing source path must remain inside an operator-configured media root."
          />
        )}
        {pickerError ? <Notice danger>{pickerError}</Notice> : null}
        <Notice>
          This is a folder visible to the Aldus server, not a folder selected from your browser.
          Aldus reads it in place and never moves, renames, or deletes source files.
        </Notice>
        <Row>
          <Button label="Cancel" onPress={onClose} />
          <Button
            label="Use this folder"
            icon="check"
            kind="primary"
            loading={busy}
            disabled={!name.trim() || !root.trim() || (creating && roots.length === 0)}
            onPress={onSave}
          />
        </Row>
      </View>
    </Dialog>
  );
}

function ReviewDialog({
  proposal,
  draft,
  works,
  representations,
  conflict,
  busy,
  onDraftChange,
  onChooseWork,
  onItemChange,
  onAccept,
  onIgnore,
  onClose,
}: {
  proposal?: ImportProposal;
  draft?: ReviewDraft;
  works: Work[];
  representations: Representation[];
  conflict: string;
  busy: boolean;
  onDraftChange: (draft: ReviewDraft) => void;
  onChooseWork: (workID: string) => void;
  onItemChange: (
    entryID: string,
    key: 'kind' | 'label' | 'representationID',
    value: string,
  ) => void;
  onAccept: () => void;
  onIgnore: () => void;
  onClose: () => void;
}) {
  if (!proposal || !draft) return null;
  return (
    <Dialog visible title="Review import proposal" onClose={onClose} wide>
      <ScrollView contentContainerStyle={styles.reviewContent}>
        {conflict ? <Notice danger>{conflict}</Notice> : null}
        <View>
          <Text style={styles.reviewTitle}>{proposal.title || 'Untitled discovery'}</Text>
          <Text style={shared.itemMeta}>
            {proposal.confidence} confidence · {humanState(proposal.state)}
          </Text>
        </View>
        <View style={styles.evidence}>
          <Text style={styles.subheading}>Why Aldus grouped these files</Text>
          {proposal.reasons.map((reason) => (
            <Text key={reason} style={shared.itemMeta}>
              • {reason}
            </Text>
          ))}
        </View>
        <View style={styles.reviewSection}>
          <Text style={styles.subheading}>Destination Work</Text>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: !draft.workID }}
            onPress={() => onChooseWork('')}
            style={[styles.choice, !draft.workID && styles.choiceSelected]}
          >
            <Text style={styles.choiceTitle}>Create a new Work</Text>
            <Text style={shared.itemMeta}>Use the reviewed title and author below.</Text>
          </Pressable>
          {works.map((work) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.workID === work.id }}
              key={work.id}
              onPress={() => onChooseWork(work.id)}
              style={[styles.choice, draft.workID === work.id && styles.choiceSelected]}
            >
              <Text style={styles.choiceTitle}>{work.title}</Text>
              <Text style={shared.itemMeta}>
                {work.author || 'Unknown author'}
                {work.id === proposal.existing_work_id ? ' · Suggested match' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldGrow}>
            <Field
              label="Work title"
              value={draft.title}
              onChangeText={(title) => onDraftChange({ ...draft, title })}
            />
          </View>
          <View style={styles.fieldGrow}>
            <Field
              label="Author"
              value={draft.author}
              onChangeText={(author) => onDraftChange({ ...draft, author })}
            />
          </View>
        </View>
        <View style={styles.reviewSection}>
          <Text style={styles.subheading}>Representations</Text>
          {proposal.items.map((item) => {
            const edit = draft.items[item.source_entry_id];
            const compatible = representations.filter(
              (representation) => representation.kind === edit.kind,
            );
            return (
              <View key={item.source_entry_id} style={styles.reviewItem}>
                <Text selectable style={styles.entryPath}>
                  {item.relative_path}
                </Text>
                <Text style={shared.itemMeta}>
                  {item.duplicate ? 'Exact duplicate · ' : ''}SHA-256 {item.sha256.slice(0, 12)}…
                </Text>
                <View style={styles.fieldRow}>
                  <View style={styles.fieldGrow}>
                    <Field
                      label="Kind"
                      value={edit.kind}
                      onChangeText={(value) => onItemChange(item.source_entry_id, 'kind', value)}
                    />
                  </View>
                  <View style={styles.fieldGrow}>
                    <Field
                      label="Label"
                      value={edit.label}
                      onChangeText={(value) => onItemChange(item.source_entry_id, 'label', value)}
                    />
                  </View>
                </View>
                {draft.workID && compatible.length > 0 ? (
                  <View style={styles.existingRepresentations}>
                    <Text style={shared.itemMeta}>
                      Attach to an existing Representation (optional)
                    </Text>
                    <Row>
                      <Button
                        label="Create new"
                        kind={!edit.representationID ? 'primary' : 'secondary'}
                        onPress={() => onItemChange(item.source_entry_id, 'representationID', '')}
                      />
                      {compatible.map((representation) => (
                        <Button
                          key={representation.id}
                          label={representation.label}
                          kind={
                            edit.representationID === representation.id ? 'primary' : 'secondary'
                          }
                          onPress={() =>
                            onItemChange(
                              item.source_entry_id,
                              'representationID',
                              representation.id,
                            )
                          }
                        />
                      ))}
                    </Row>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        <Row>
          <Button
            label={
              busy ? 'Importing…' : draft.workID ? 'Import into Work' : 'Create Work and import'
            }
            kind="primary"
            disabled={busy || (!draft.workID && !draft.title.trim())}
            onPress={onAccept}
          />
          <Button label="Ignore proposal" kind="danger" disabled={busy} onPress={onIgnore} />
          <Button label="Cancel" kind="quiet" onPress={onClose} />
        </Row>
      </ScrollView>
    </Dialog>
  );
}

function Dialog({
  visible,
  title,
  wide,
  onClose,
  children,
}: React.PropsWithChildren<{
  visible: boolean;
  title: string;
  wide?: boolean;
  onClose: () => void;
}>) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          accessibilityRole="none"
          style={[styles.dialog, wide && styles.wideDialog]}
          onPress={() => {}}
        >
          <View style={styles.dialogHeader}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>
              {title}
            </Text>
            <Button label="Close" kind="quiet" onPress={onClose} />
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StatePill({ state }: { state: string }) {
  const danger = ['failed', 'error', 'missing', 'invalid', 'unavailable'].includes(state);
  const attention = state === 'review_required' || state === 'pending' || state === 'scanning';
  return (
    <View style={[styles.pill, attention && styles.attentionPill, danger && styles.dangerPill]}>
      <Text style={[styles.pillText, danger && styles.dangerText]}>{humanState(state)}</Text>
    </View>
  );
}

function metadataText(entry: SourceEntry, key: string) {
  const value = entry.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function humanState(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value?: string) {
  if (!value) return 'Not started';
  return new Date(value).toLocaleString();
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  libraryTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  libraryTab: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    backgroundColor: colors.paper,
  },
  libraryTabSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  libraryTabText: { color: colors.ink, fontWeight: '700' },
  libraryTabTextSelected: { color: colors.paper },
  relationship: { maxWidth: 760, gap: 5 },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  relationshipTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 22, fontWeight: '700' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 },
  sourceCard: {
    flexGrow: 1,
    flexBasis: 420,
    minWidth: 0,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.paper,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  grow: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '800' },
  scanSummary: { gap: 10, padding: 12, backgroundColor: colors.canvas, borderRadius: 6 },
  scanTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  count: { minWidth: 62 },
  countValue: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  countLabel: { color: colors.muted, fontSize: 11 },
  history: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  entryList: { gap: 0, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  entry: { gap: 4, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  entryPath: {
    flexShrink: 1,
    color: colors.ink,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  proposalList: { gap: 12 },
  proposalCard: {
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 7,
    backgroundColor: colors.paper,
  },
  needsReview: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  proposalMeta: { color: colors.ink, fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  suggestion: { color: '#405843', fontSize: 13, fontWeight: '700' },
  pill: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#e1e9df',
  },
  attentionPill: { backgroundColor: colors.accentSoft },
  dangerPill: { backgroundColor: '#f1d9d5' },
  pillText: { color: '#405843', fontSize: 11, fontWeight: '800' },
  dangerText: { color: colors.danger },
  backdrop: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(41,35,29,.48)',
  },
  dialog: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    padding: 20,
    gap: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.paper,
  },
  wideDialog: { maxWidth: 920 },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dialogTitle: {
    flexShrink: 1,
    color: colors.ink,
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '700',
  },
  reviewContent: { gap: 22, paddingBottom: 6 },
  reviewTitle: { color: colors.ink, fontFamily: 'Georgia', fontSize: 24, fontWeight: '700' },
  evidence: { gap: 5, padding: 12, backgroundColor: colors.canvas, borderRadius: 6 },
  reviewSection: { gap: 10 },
  subheading: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  choice: {
    minHeight: 54,
    justifyContent: 'center',
    padding: 11,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fieldGrow: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
  reviewItem: { gap: 10, padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 6 },
  existingRepresentations: { gap: 7 },
  noRoots: {
    minHeight: 150,
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 7,
    backgroundColor: colors.canvas,
  },
  folderPicker: { gap: 10 },
  rootChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  folderLocation: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    backgroundColor: colors.canvas,
  },
  folderPath: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '700' },
  folderList: {
    maxHeight: 280,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    overflow: 'hidden',
  },
  folderRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.paper,
  },
  folderName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '700' },
});
