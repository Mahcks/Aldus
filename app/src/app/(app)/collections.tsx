import type { Collection } from '@/generated/api';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { collectionCount } from '@/features/collection-presentation';
import { AppIcon } from '@/features/icons';
import { colors } from '@/features/theme';
import { Pressable, Text, View } from '@/features/tw';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Page,
  resolvePressStateClass,
  Section,
  TextField,
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';

function CollectionRow({ item, shared = false }: { item: Collection; shared?: boolean }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const subtitle = item.description
    ? `${collectionCount(item.work_count)} · ${item.description}`
    : collectionCount(item.work_count);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.title}, ${collectionCount(item.work_count)}`}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => router.push(`/collection/${item.id}${shared ? '?shared=1' : ''}`)}
      className={`min-h-16 flex-row items-center gap-3 border-b border-line py-3 ${stateClass}`}
    >
      <View className="h-11 w-11 items-center justify-center">
        <AppIcon name="collections" size={22} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={1} className="font-editorial-bold text-lg text-ink">
          {item.title}
        </Text>
        <Text numberOfLines={2} className="text-sm leading-5 text-muted">
          {shared ? `${item.shared_library_name} · ${item.owner_name} · ` : ''}
          {subtitle}
        </Text>
      </View>
      <AppIcon name="chevron" size={20} color={colors.subtle} />
    </Pressable>
  );
}

export default function CollectionsScreen() {
  const [items, setItems] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharedItems, setSharedItems] = useState<Collection[]>([]);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [sharedError, setSharedError] = useState('');
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedMore, setSharedMore] = useState(false);

  async function loadShared(append = false) {
    if (sharedBusy) return;
    setSharedOpen(true);
    setSharedBusy(true);
    setSharedError('');
    try {
      const values = await api.sharedCollections(append ? sharedItems.length : 0);
      setSharedItems((previous) => (append ? [...previous, ...values] : values));
      setSharedMore(values.length === 100);
    } catch (cause) {
      setSharedError(
        cause instanceof APIError && cause.status === 404
          ? 'Shared collections are not available on this server yet.'
          : errorMessage(cause),
      );
    } finally {
      setSharedBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      setItems(await api.collections());
      setError('');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function closeCreate() {
    if (busy) return;
    setCreateOpen(false);
    setCreateError('');
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setBusy(true);
    setCreateError('');
    try {
      const created = await api.createCollection({ title, description });
      setTitle('');
      setDescription('');
      setCreateOpen(false);
      router.push(`/collection/${created.id}`);
    } catch (value) {
      setCreateError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Page title="Collections" hideHeader>
        <LoadingState label="Loading collections…" />
      </Page>
    );
  }

  if (error && items.length === 0) {
    return (
      <Page title="Collections" hideHeader>
        <ErrorState
          title="Collections are unavailable"
          action={<Button label="Try again" kind="secondary" onPress={() => void load()} />}
        >
          {error}
        </ErrorState>
      </Page>
    );
  }

  return (
    <Page title="Collections" hideHeader>
      {error ? <Notice danger>{error}</Notice> : null}
      <Button
        label={sharedOpen ? 'Refresh shared collections' : 'Shared with your libraries'}
        kind="secondary"
        onPress={() => void loadShared()}
      />
      {sharedOpen ? (
        <Section title="Shared collections">
          {sharedError ? <Notice danger>{sharedError}</Notice> : null}
          {sharedItems.map((item) => (
            <CollectionRow key={item.id} item={item} shared />
          ))}
          {sharedBusy ? <LoadingState label="Loading shared collections…" /> : null}
          {!sharedBusy && !sharedError && !sharedItems.length ? (
            <EmptyState icon="collections" title="No shared collections yet">
              Share a collection with a library to let its members read the list.
            </EmptyState>
          ) : null}
          {sharedMore ? (
            <Button
              label="More shared collections"
              disabled={sharedBusy}
              onPress={() => void loadShared(true)}
            />
          ) : null}
        </Section>
      ) : null}
      {items.length === 0 ? (
        <View className="w-full flex-1 items-center justify-center">
          <EmptyState
            icon="collections"
            title="Make your first collection"
            action={
              <Button
                label="New collection"
                icon="add"
                kind="primary"
                onPress={() => setCreateOpen(true)}
              />
            }
          >
            Keep books together for a trip, a reading goal, or simply because they belong together.
          </EmptyState>
        </View>
      ) : (
        <Section
          title="Your collections"
          action={
            <Button
              label="New collection"
              icon="add"
              kind="primary"
              onPress={() => setCreateOpen(true)}
            />
          }
        >
          <View>
            {items.map((item) => (
              <CollectionRow key={item.id} item={item} />
            ))}
          </View>
        </Section>
      )}
      <Dialog visible={createOpen} title="New collection" onClose={closeCreate}>
        <View className="gap-4">
          {createError ? <Notice danger>{createError}</Notice> : null}
          <TextField
            label="Name"
            value={title}
            autoFocus
            onChangeText={setTitle}
            onSubmitEditing={() => void handleCreate()}
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
            label="Create collection"
            kind="primary"
            loading={busy}
            disabled={!title.trim()}
            onPress={() => void handleCreate()}
          />
        </View>
      </Dialog>
    </Page>
  );
}
