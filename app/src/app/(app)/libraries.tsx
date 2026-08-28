import type { Library } from '@/generated/api';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import Animated from 'react-native-reanimated';
import { LibraryCard } from '@/features/bookshelf';
import { AppIcon } from '@/features/icons';
import { listItemEnter } from '@/features/motion';
import { Text, View } from '@/features/tw';
import {
  Button,
  colors,
  Dialog,
  Loading,
  Notice,
  Page,
  SectionHeader,
  TextField,
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';
import { offlineLibraries, rememberOfflineLibraries } from '@/lib/offline-library';

type CreateLibraryFormProps = {
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string;
};

function CreateLibraryForm({ name, onNameChange, onSubmit, busy, error }: CreateLibraryFormProps) {
  return (
    <View className="gap-4">
      {error ? <Notice danger>{error}</Notice> : null}
      <TextField
        label="Library name"
        value={name}
        onChangeText={onNameChange}
        onSubmitEditing={onSubmit}
      />
      <Button
        label={busy ? 'Creating…' : 'Create library'}
        kind="primary"
        disabled={busy || !name.trim()}
        loading={busy}
        onPress={onSubmit}
      />
    </View>
  );
}

/** Single centered "let's get started" moment — used only when there are no libraries yet. */
function FirstLibraryHero(props: CreateLibraryFormProps) {
  return (
    <View className="mx-auto w-full max-w-[440px] items-center gap-5 rounded-card border border-line bg-paper p-8 text-center shadow-card">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name="libraries" size={28} color={colors.accent} />
      </View>
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-center text-lg font-sans-bold text-ink">
          Create your first library
        </Text>
        <Text className="text-center text-base leading-6 text-muted">
          A Library groups your books and audiobooks under one set of sources and members. Give it a
          name to get started.
        </Text>
      </View>
      <View className="w-full">
        <CreateLibraryForm {...props} />
      </View>
    </View>
  );
}

export default function Libraries() {
  const [items, setItems] = useState<Library[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const libraries = await api.libraries();
      setItems(libraries);
      setError('');
      setOffline(false);
      await rememberOfflineLibraries(libraries).catch(() => {});
    } catch (value) {
      if (!(value instanceof APIError && value.status === 0)) {
        setError(errorMessage(value));
        return;
      }
      const saved = await offlineLibraries();
      setItems(saved);
      setOffline(saved.length > 0);
      setError(saved.length ? '' : errorMessage(value));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openLibrary(library: Library) {
    router.push(`/library/${library.id}`);
  }

  async function handleCreate() {
    setBusy(true);
    setCreateError('');
    try {
      const library = await api.createLibrary({ name });
      setName('');
      setCreateOpen(false);
      router.push(`/library/${library.id}`);
    } catch (value) {
      setCreateError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Libraries"
      actions={
        items.length && !offline ? (
          <Button
            label="Add library"
            icon="add"
            kind="primary"
            onPress={() => setCreateOpen(true)}
          />
        ) : null
      }
    >
      {offline ? <Notice>Offline · showing libraries with downloads on this device.</Notice> : null}
      {error ? <Notice danger>{error}</Notice> : null}
      {loading ? (
        <Loading label="Loading libraries…" />
      ) : items.length === 0 ? (
        <FirstLibraryHero
          name={name}
          onNameChange={setName}
          onSubmit={handleCreate}
          busy={busy}
          error={createError}
        />
      ) : (
        <View className="gap-3">
          <SectionHeader title="Your libraries" />
          <View className="flex-row flex-wrap gap-3">
            {items.map((item, index) => (
              <Animated.View key={item.id} entering={listItemEnter(index)}>
                <LibraryCard name={item.name} role={item.role} onPress={() => openLibrary(item)} />
              </Animated.View>
            ))}
          </View>
        </View>
      )}
      <Dialog visible={createOpen} title="Add library" onClose={() => setCreateOpen(false)}>
        <CreateLibraryForm
          name={name}
          onNameChange={setName}
          onSubmit={handleCreate}
          busy={busy}
          error={createError}
        />
      </Dialog>
    </Page>
  );
}
