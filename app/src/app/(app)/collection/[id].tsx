import type { Collection, CollectionWork, Library } from '@/generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { WorkRow } from '@/features/bookshelf';
import { moveCollectionWork } from '@/features/collection-presentation';
import { Text, View } from '@/features/tw';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Page,
  Row,
  Section,
  Radio,
  TextField,
} from '@/features/ui';
import { api, errorMessage } from '@/lib/api';
import { goBackOr } from '@/lib/navigation';

export default function CollectionDetailScreen() {
  const { id, shared } = useLocalSearchParams<{ id: string; shared?: string }>();
  const loadSequence = useRef(0);
  const [collection, setCollection] = useState<Collection>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeWork, setRemoveWork] = useState<CollectionWork>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [sharingLibrary, setSharingLibrary] = useState('');

  async function openSharing() {
    setDialogError('');
    setSharingLibrary(collection?.shared_library_id ?? '');
    setSharingOpen(true);
    setBusy(true);
    try {
      const values: Library[] = [];
      for (;;) {
        const page = await api.libraries(values.length);
        values.push(...page);
        if (page.length < 100) break;
      }
      setLibraries(values.filter((library) => library.effective));
    } catch (cause) {
      setDialogError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveSharing() {
    if (!id || busy) return;
    setBusy(true);
    setDialogError('');
    try {
      await api.shareCollection(id, sharingLibrary);
      setSharingOpen(false);
      // Use owner route after unsharing, since the shared route is no longer visible.
      setCollection(await api.collection(id));
      router.setParams({ shared: undefined });
    } catch (cause) {
      setDialogError(
        'Could not change sharing. All books must belong to the selected library, and this server must support shared collections. ' +
          errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    if (!id) return;
    const sequence = ++loadSequence.current;
    try {
      const value = await (shared ? api.sharedCollection(id) : api.collection(id));
      if (sequence !== loadSequence.current) return;
      setCollection(value);
      setError('');
    } catch (value) {
      if (sequence !== loadSequence.current) return;
      setCollection(undefined);
      setError(errorMessage(value));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const sequence = loadSequence;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      sequence.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shared]);

  function openEdit() {
    if (!collection) return;
    setTitle(collection.title);
    setDescription(collection.description ?? '');
    setDialogError('');
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!id || !title.trim()) return;
    setBusy(true);
    setDialogError('');
    try {
      setCollection(await api.updateCollection(id, { title, description }));
      setEditOpen(false);
    } catch (value) {
      setDialogError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setBusy(true);
    setDialogError('');
    try {
      await api.deleteCollection(id);
      router.replace('/collections');
    } catch (value) {
      setError(errorMessage(value));
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!id || !removeWork || !collection) return;
    setBusy(true);
    setDialogError('');
    try {
      await api.removeCollectionWork(id, removeWork.id);
      setCollection({
        ...collection,
        work_count: Math.max(0, collection.work_count - 1),
        works: (collection.works ?? []).filter((work) => work.id !== removeWork.id),
      });
      setRemoveWork(undefined);
    } catch (value) {
      setError(errorMessage(value));
      setRemoveWork(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!id || !collection) return;
    const works = collection.works ?? [];
    const currentIDs = works.map((work) => work.id);
    const nextIDs = moveCollectionWork(currentIDs, index, direction);
    if (nextIDs === currentIDs) return;
    setReordering(true);
    setError('');
    try {
      await api.reorderCollectionWorks(id, nextIDs);
      const byID = new Map(works.map((work) => [work.id, work]));
      setCollection({
        ...collection,
        works: nextIDs.map((workID, position) => ({ ...byID.get(workID)!, position })),
      });
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setReordering(false);
    }
  }

  async function openWork(workID: string) {
    try {
      const work = await api.work(workID);
      router.push(`/work/${work.id}`);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  if (loading) {
    return (
      <Page title="Collection" hideHeader>
        <LoadingState label="Loading collection…" />
      </Page>
    );
  }

  if (!collection) {
    return (
      <Page title="Collection" hideHeader>
        <ErrorState
          title="Collection unavailable"
          action={
            <Button label="Go back" kind="secondary" onPress={() => goBackOr('/collections')} />
          }
        >
          {error || 'This collection may have been removed.'}
        </ErrorState>
      </Page>
    );
  }

  const works = collection.works ?? [];

  return (
    <Page
      title={collection.title}
      back={
        <IconButton
          icon="back"
          label="Back to collections"
          kind="quiet"
          onPress={() => goBackOr('/collections')}
        />
      }
      actions={
        !shared || collection.can_edit ? (
          <Row>
            <Button label="Sharing" kind="secondary" onPress={() => void openSharing()} />
            <Button label="Edit" icon="edit" kind="secondary" onPress={openEdit} />
          </Row>
        ) : undefined
      }
    >
      {collection.shared_library_id ? (
        <Text className="text-sm text-muted">
          Shared with {collection.shared_library_name || 'a library'}
          {collection.owner_name ? ` · By ${collection.owner_name}` : ''}.{' '}
          {shared && !collection.can_edit ? 'Only the creator can edit this list.' : ''}
        </Text>
      ) : null}
      {collection.description ? (
        <Text className="max-w-[680px] text-base leading-6 text-muted">
          {collection.description}
        </Text>
      ) : null}
      {error ? <Notice danger>{error}</Notice> : null}
      {works.length === 0 ? (
        <EmptyState icon="collections" title="This collection is empty">
          Add books from your Library or a book page.
        </EmptyState>
      ) : (
        <Section
          title={`${works.length} ${works.length === 1 ? 'book' : 'books'}`}
          action={
            !shared || collection.can_edit ? (
              <Button
                label={arranging ? 'Done arranging' : 'Arrange books'}
                kind="quiet"
                disabled={reordering}
                onPress={() => setArranging((value) => !value)}
              />
            ) : undefined
          }
        >
          <View>
            {works.map((work, index) => (
              <View key={work.id}>
                <WorkRow
                  title={work.title}
                  author={work.author}
                  coverURL={work.cover_url}
                  onPress={() => void openWork(work.id)}
                />
                {arranging && (!shared || collection.can_edit) ? (
                  <View className="flex-row items-center justify-end gap-1 border-b border-line pb-2">
                    <IconButton
                      icon="moveUp"
                      label={`Move ${work.title} up`}
                      kind="quiet"
                      disabled={reordering || index === 0}
                      onPress={() => void handleMove(index, -1)}
                    />
                    <IconButton
                      icon="moveDown"
                      label={`Move ${work.title} down`}
                      kind="quiet"
                      disabled={reordering || index === works.length - 1}
                      onPress={() => void handleMove(index, 1)}
                    />
                    <IconButton
                      icon="delete"
                      label={`Remove ${work.title} from collection`}
                      kind="quiet"
                      disabled={reordering}
                      onPress={() => setRemoveWork(work)}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </Section>
      )}

      <Dialog
        visible={sharingOpen}
        title="Share collection"
        sheet
        footer={
          <Button
            label="Save sharing"
            kind="primary"
            loading={busy}
            onPress={() => void saveSharing()}
          />
        }
        onClose={() => {
          if (!busy) setSharingOpen(false);
        }}
      >
        <View className="gap-4">
          <Text className="text-base text-ink">
            Members of the selected library can read this list. Only you can edit it. Everyone keeps
            their own reading progress.
          </Text>
          {dialogError ? <Notice danger>{dialogError}</Notice> : null}
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Who can see this collection"
            className="gap-2"
          >
            <View className="border-b border-line-subtle pb-3">
              <Radio
                label="Only me"
                selected={!sharingLibrary}
                disabled={busy}
                onPress={() => setSharingLibrary('')}
              />
              <Text className="pl-8 text-sm text-muted">Keep this collection private.</Text>
            </View>
            {libraries.map((library) => (
              <Radio
                key={library.id}
                label={library.name}
                selected={sharingLibrary === library.id}
                disabled={busy}
                onPress={() => setSharingLibrary(library.id)}
              />
            ))}
          </View>
          <Text className="text-sm text-muted">
            All books in a shared collection must belong to that library.
          </Text>
        </View>
      </Dialog>
      <Dialog
        visible={editOpen}
        title="Edit collection"
        sheet
        onClose={() => {
          if (!busy) setEditOpen(false);
        }}
        footer={
          <Button
            label="Save changes"
            kind="primary"
            loading={busy}
            disabled={!title.trim()}
            onPress={() => void handleEdit()}
          />
        }
      >
        <View className="gap-4">
          {dialogError ? <Notice danger>{dialogError}</Notice> : null}
          <TextField
            label="Name"
            value={title}
            autoFocus
            onChangeText={setTitle}
            onSubmitEditing={() => void handleEdit()}
          />
          <TextField
            label="Description"
            help="Optional"
            value={description}
            multiline
            numberOfLines={3}
            onChangeText={setDescription}
          />
          <View className="items-start border-t border-line pt-4">
            <Button
              label="Delete collection"
              kind="quiet"
              icon="delete"
              disabled={busy}
              onPress={() => {
                setEditOpen(false);
                setDeleteOpen(true);
              }}
            />
          </View>
        </View>
      </Dialog>
      <ConfirmDialog
        visible={deleteOpen}
        title="Delete collection?"
        description={`Delete “${collection.title}”? The books will remain in Aldus.`}
        confirmLabel="Delete collection"
        danger
        busy={busy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
      <ConfirmDialog
        visible={Boolean(removeWork)}
        title="Remove book?"
        description={`Remove “${removeWork?.title ?? 'this book'}” from this collection?`}
        confirmLabel="Remove book"
        busy={busy}
        onClose={() => setRemoveWork(undefined)}
        onConfirm={() => void handleRemove()}
      />
    </Page>
  );
}
