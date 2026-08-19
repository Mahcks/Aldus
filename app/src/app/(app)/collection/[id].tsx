import type { Collection, CollectionWork } from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { WorkRow } from '../../../features/bookshelf';
import { moveCollectionWork } from '../../../features/collection-presentation';
import { View } from '../../../features/tw';
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
  TextField,
} from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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

  async function load() {
    if (!id) return;
    try {
      const value = await api.collection(id);
      setCollection(value);
      setError('');
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
  }, [id]);

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
      router.push(`/work/${work.id}?libraryId=${work.library_id}`);
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
        <Row>
          <Button label="Edit" icon="edit" kind="secondary" onPress={openEdit} />
          <Button label="Delete" icon="delete" kind="danger" onPress={() => setDeleteOpen(true)} />
        </Row>
      }
    >
      {collection.description ? <Notice>{collection.description}</Notice> : null}
      {error ? <Notice danger>{error}</Notice> : null}
      {works.length === 0 ? (
        <EmptyState icon="collections" title="This collection is empty">
          Add books from Search or a book page.
        </EmptyState>
      ) : (
        <Section title={`${works.length} ${works.length === 1 ? 'book' : 'books'}`}>
          <View>
            {works.map((work, index) => (
              <WorkRow
                key={work.id}
                title={work.title}
                author={work.author}
                coverURL={work.cover_url}
                onPress={() => void openWork(work.id)}
                action={
                  <View className="flex-row items-center gap-1">
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
                }
              />
            ))}
          </View>
        </Section>
      )}

      <Dialog visible={editOpen} title="Edit collection" onClose={() => setEditOpen(false)}>
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
          <Button
            label="Save changes"
            kind="primary"
            loading={busy}
            disabled={!title.trim()}
            onPress={() => void handleEdit()}
          />
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
