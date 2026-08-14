import type { Library } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppIcon } from '../../features/icons';
import { Pressable, Text, View } from '../../features/tw';
import {
  Button,
  colors,
  Dialog,
  Loading,
  Notice,
  Page,
  SectionHeader,
  TextField,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

/**
 * Duplicates the list-row markup in `home.tsx`. A future pass could extract
 * a shared `features/libraries.tsx` list-row component; not required for
 * this redesign.
 */
function LibraryRow({ library, onPress }: { library: Library; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      className="flex-row items-center justify-between gap-4 rounded-card border border-line bg-paper px-4 py-3.5 shadow-xs"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <AppIcon name="libraries" size={18} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base font-bold text-ink">
            {library.name}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted">
            {library.role || 'Administrator access'}
          </Text>
        </View>
      </View>
      <AppIcon name="chevron" size={20} color={colors.subtle} />
    </Pressable>
  );
}

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
        <Text accessibilityRole="header" className="text-center text-lg font-bold text-ink">
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

  async function load() {
    try {
      setItems(await api.libraries());
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  // Data loading is the external synchronization this effect owns.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

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
        items.length ? (
          <Button
            label="Add library"
            icon="add"
            kind="primary"
            onPress={() => setCreateOpen(true)}
          />
        ) : null
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <FirstLibraryHero
          name={name}
          onNameChange={setName}
          onSubmit={handleCreate}
          busy={busy}
          error={createError}
        />
      ) : (
        <View className="max-w-[760px] gap-3">
          <SectionHeader title="Your libraries" />
          <View className="gap-3">
            {items.map((item) => (
              <LibraryRow key={item.id} library={item} onPress={() => openLibrary(item)} />
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
