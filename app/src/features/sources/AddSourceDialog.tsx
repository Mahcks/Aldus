import { useEffect, useRef, useState } from 'react';
import type { LibrarySource, SourceDirectoryListing, SourceRoot } from '../../generated/api';
import { childDirectory, deriveSourceName, parentDirectory } from '../source-administration';
import { findRootForPath } from './helpers';
import { AppIcon } from '../icons';
import { Button, Checkbox, Dialog, Field, Notice, Row, colors } from '../ui';
import { Pressable, ScrollView, Text, View } from '../tw';
import { api, errorMessage } from '../../lib/api';

type Props = {
  visible: boolean;
  mode: 'create' | 'edit';
  source?: LibrarySource;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; rootPath: string; autoImport: boolean }) => Promise<void>;
};

/**
 * Guided "choose a folder, name it, add it" flow, shared between creating a
 * new source and editing an existing one. Editing pre-selects the root and
 * relative path that back the current `root_path` so the same browser can be
 * reused for both, per the source-administration redesign.
 */
export function AddSourceDialog({ visible, mode, source, busy, onClose, onSubmit }: Props) {
  const [roots, setRoots] = useState<SourceRoot[]>([]);
  const [rootsLoading, setRootsLoading] = useState(true);
  const [rootsError, setRootsError] = useState('');
  const [selectedRoot, setSelectedRoot] = useState<SourceRoot>();
  const [directory, setDirectory] = useState<SourceDirectoryListing>();
  const [directoryError, setDirectoryError] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [autoImport, setAutoImport] = useState(false);
  const [showSetupDetails, setShowSetupDetails] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const autoSelectedRef = useRef(false);

  const missingReason = !directory
    ? 'Choose a folder to continue'
    : !name.trim()
      ? 'Give this source a name'
      : '';

  async function loadRoots() {
    setRootsLoading(true);
    setRootsError('');
    try {
      setRoots(await api.sourceRoots());
    } catch (value) {
      setRootsError(errorMessage(value));
    } finally {
      setRootsLoading(false);
    }
  }

  async function openDirectory(root: SourceRoot, path = '') {
    setDirectoryError('');
    try {
      const listing = await api.sourceDirectories(root.id, path);
      setSelectedRoot(root);
      setDirectory(listing);
      setName((current) => (nameEdited ? current : deriveSourceName(listing.selected_path)));
    } catch (value) {
      setDirectoryError(errorMessage(value));
    }
  }

  function changeRoot() {
    setSelectedRoot(undefined);
    setDirectory(undefined);
  }

  function handleNameChange(value: string) {
    setNameEdited(true);
    setName(value);
  }

  async function handleSubmit() {
    if (!directory || !name.trim()) return;
    setSubmitError('');
    try {
      await onSubmit({ name: name.trim(), rootPath: directory.selected_path, autoImport });
    } catch (value) {
      setSubmitError(errorMessage(value));
    }
  }

  useEffect(() => {
    if (!visible) return;
    // Dialog-open bootstrap. The dialog component stays mounted between
    // opens (the parent toggles `visible`, not JSX presence), so every field
    // from a previous create/edit session must be reset here rather than via
    // `useState` initializers, which only run once on first mount.
    autoSelectedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedRoot(undefined);
    setDirectory(undefined);
    setDirectoryError('');
    setSubmitError('');
    setShowSetupDetails(false);
    setName(mode === 'edit' ? (source?.name ?? '') : '');
    setNameEdited(mode === 'edit');
    setAutoImport(mode === 'edit' ? Boolean(source?.auto_import) : false);
    void loadRoots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || rootsLoading || autoSelectedRef.current || roots.length === 0) return;
    autoSelectedRef.current = true;
    if (mode === 'edit' && source) {
      const match = findRootForPath(roots, source.root_path);
      if (match) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void openDirectory(match.root, match.relativePath);
        return;
      }
    }
    if (mode === 'create' && roots.length === 1) {
      void openDirectory(roots[0]!, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rootsLoading, roots, mode, source]);

  if (!visible) return null;

  const title = mode === 'create' ? 'Add source' : 'Edit source';

  return (
    <Dialog visible={visible} title={title} onClose={onClose}>
      <View className="gap-5">
        <Notice>
          Choose a folder Aldus can scan for EPUB and audiobook files. Aldus reads files in place
          and never moves or deletes them.
        </Notice>

        {rootsLoading ? (
          <Text className="text-base text-muted">Loading available folders…</Text>
        ) : rootsError ? (
          <Notice danger>{rootsError}</Notice>
        ) : roots.length === 0 ? (
          <NoRootsSetup
            expanded={showSetupDetails}
            onToggle={() => setShowSetupDetails((v) => !v)}
          />
        ) : (
          <View className="gap-4">
            {selectedRoot && directory ? (
              <FolderBrowser
                directory={directory}
                root={selectedRoot}
                roots={roots}
                onChangeRoot={changeRoot}
                onNavigate={(path) => void openDirectory(selectedRoot, path)}
              />
            ) : (
              <RootPicker roots={roots} onChoose={(root) => void openDirectory(root, '')} />
            )}
            {directoryError ? <Notice danger>{directoryError}</Notice> : null}
          </View>
        )}

        {directory ? (
          <View className="gap-4">
            <Field label="Source name" value={name} onChangeText={handleNameChange} />
            <View className="gap-1">
              <Checkbox
                checked={autoImport}
                onPress={() => setAutoImport((current) => !current)}
                label="Import clear matches automatically"
              />
              <Text className="pl-8 text-sm text-muted">
                Books and audiobooks with clear metadata skip Review. Anything uncertain still waits
                for you.
              </Text>
            </View>
          </View>
        ) : null}

        {submitError ? <Notice danger>{submitError}</Notice> : null}

        <View className="gap-2">
          <Row>
            <Button label="Cancel" onPress={onClose} disabled={busy} />
            <Button
              label={mode === 'create' ? 'Add source' : 'Save changes'}
              icon="check"
              kind="primary"
              loading={busy}
              disabled={Boolean(missingReason) || busy}
              onPress={() => void handleSubmit()}
            />
          </Row>
          {missingReason ? <Text className="text-xs text-muted">{missingReason}</Text> : null}
        </View>
      </View>
    </Dialog>
  );
}

function RootPicker({
  roots,
  onChoose,
}: {
  roots: SourceRoot[];
  onChoose: (root: SourceRoot) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">Choose a starting location</Text>
      <View className="gap-2">
        {roots.map((root) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Browse ${root.label}`}
            key={root.id}
            onPress={() => onChoose(root)}
            className="min-h-11 flex-row items-center gap-3 rounded-control border border-line-strong bg-paper px-3 py-2.5"
          >
            <AppIcon name="folder" size={20} color={colors.accent} />
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-bold text-ink">{root.label}</Text>
              <Text className="font-mono text-xs text-muted">{root.path}</Text>
            </View>
            <AppIcon name="chevron" size={18} color={colors.subtle} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function FolderBrowser({
  root,
  roots,
  directory,
  onNavigate,
  onChangeRoot,
}: {
  root: SourceRoot;
  roots: SourceRoot[];
  directory: SourceDirectoryListing;
  onNavigate: (path: string) => void;
  onChangeRoot: () => void;
}) {
  const parent = parentDirectory(directory.relative_path);
  const selectedName = directory.relative_path.split('/').filter(Boolean).at(-1) ?? root.label;

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Breadcrumb root={root} relativePath={directory.relative_path} onNavigate={onNavigate} />
        {roots.length > 1 ? (
          <Button label="Change folder" kind="quiet" onPress={onChangeRoot} />
        ) : null}
      </View>
      <View className="gap-1 rounded-control border border-accent bg-accent-soft p-3">
        <View className="flex-row items-center gap-2">
          <AppIcon name="check" size={18} color={colors.accent} />
          <Text className="text-sm font-bold text-ink">Selected folder: {selectedName}</Text>
        </View>
        <Text className="text-sm text-muted">Everything inside this folder will be scanned.</Text>
        <Text selectable className="font-mono text-xs text-muted">
          {directory.selected_path}
        </Text>
      </View>
      {directory.directories.length > 0 ? (
        <Text className="text-sm font-semibold text-muted">Or choose a subfolder instead</Text>
      ) : null}
      <ScrollView className="max-h-[260px] rounded-control border border-line-strong">
        {directory.has_parent ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open parent folder"
            onPress={() => onNavigate(parent)}
            className="min-h-11 flex-row items-center gap-2.5 border-b border-line bg-paper px-3"
          >
            <AppIcon name="back" size={18} color={colors.muted} />
            <Text className="flex-1 text-sm font-semibold text-ink">Parent folder</Text>
          </Pressable>
        ) : null}
        {directory.directories.map((folder) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${folder}`}
            key={folder}
            onPress={() => onNavigate(childDirectory(directory.relative_path, folder))}
            className="min-h-11 flex-row items-center gap-2.5 border-b border-line bg-paper px-3"
          >
            <AppIcon name="folder" size={20} color={colors.warning} />
            <Text className="flex-1 text-sm font-semibold text-ink">{folder}</Text>
            <AppIcon name="chevron" size={18} color={colors.subtle} />
          </Pressable>
        ))}
        {directory.directories.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-muted">
            This folder has no subfolders. You can add the selected folder below.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Breadcrumb({
  root,
  relativePath,
  onNavigate,
}: {
  root: SourceRoot;
  relativePath: string;
  onNavigate: (path: string) => void;
}) {
  const segments = relativePath.split('/').filter(Boolean);
  const crumbs = [
    { label: root.label, path: '' },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join('/'),
    })),
  ];

  return (
    <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-1">
      {crumbs.map((crumb, index) => {
        const isCurrent = index === crumbs.length - 1;
        return (
          <View className="flex-row items-center gap-1" key={`${crumb.path}-${crumb.label}`}>
            {index > 0 ? <Text className="text-sm text-subtle">/</Text> : null}
            {isCurrent ? (
              <Text className="text-sm font-extrabold text-ink">{crumb.label}</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Go to ${crumb.label}`}
                onPress={() => onNavigate(crumb.path)}
              >
                <Text className="text-sm font-semibold text-accent">{crumb.label}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function NoRootsSetup({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <View className="gap-3 rounded-card border border-line bg-canvas p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
          <AppIcon name="folder" size={22} color={colors.accent} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-bold text-ink">
            No media folders are available to Aldus yet
          </Text>
          <Text className="text-sm text-muted">
            An administrator needs to make a folder visible to the Aldus server before a source can
            be added.
          </Text>
        </View>
      </View>
      <Button
        label={expanded ? 'Hide technical setup details' : 'Technical setup details'}
        kind="quiet"
        onPress={onToggle}
      />
      {expanded ? (
        <View className="gap-2 rounded-control bg-paper p-3">
          <Text className="text-sm leading-5 text-muted">
            Mount a host or NAS folder read-only into the Aldus server container, then list its
            server-visible path in the <Text className="font-mono text-xs">ALDUS_SOURCE_ROOTS</Text>{' '}
            environment variable and restart Aldus.
          </Text>
          <Text selectable className="font-mono text-xs text-ink">
            ALDUS_SOURCE_ROOTS=/data/books:Books
          </Text>
          <Text selectable className="font-mono text-xs text-ink">
            {'volumes:\n  - /mnt/nas/books:/data/books:ro'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
