import type { Collection } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { collectionCount } from '../../features/collection-presentation';
import { AppIcon } from '../../features/icons';
import { colors } from '../../features/theme';
import { Pressable, Text, View } from '../../features/tw';
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
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

function CollectionRow({ item }: { item: Collection }) {
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
      onPress={() => router.push(`/collection/${item.id}`)}
      className={`min-h-16 flex-row items-center gap-3 border-b border-line py-3 ${stateClass}`}
    >
      <View className="h-11 w-11 items-center justify-center">
        <AppIcon name="collections" size={22} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={1} className="font-editorial text-lg font-bold text-ink">
          {item.title}
        </Text>
        <Text numberOfLines={2} className="text-sm leading-5 text-muted">
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

  async function load() {
    try {
      setItems(await api.collections());
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
  }, []);

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
      <Page title="Collections">
        <LoadingState label="Loading collections…" />
      </Page>
    );
  }

  if (error && items.length === 0) {
    return (
      <Page title="Collections">
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
    <Page
      title="Collections"
      actions={
        <Button
          label="New collection"
          icon="add"
          kind="primary"
          onPress={() => setCreateOpen(true)}
        />
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      {items.length === 0 ? (
        <EmptyState icon="collections" title="Make your first collection">
          Keep books together for a trip, a reading goal, or simply because they belong together.
        </EmptyState>
      ) : (
        <Section title="Your collections">
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
