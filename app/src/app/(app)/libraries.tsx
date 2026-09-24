import type { Library } from '@/generated/api';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import Animated from 'react-native-reanimated';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppIcon } from '@/components/ui/icons';
import { listItemEnter } from '@/components/ui/motion';
import { resolvePressStateClass } from '@/components/ui/Button';
import { Pressable, Text, View } from '@/components/ui/tw';
import {
  Button,
  Dialog,
  IconButton,
  Loading,
  ManagementRow,
  Notice,
  SectionHeader,
  TextField,
} from '@/components/ui';
import { useThemeColors } from '@/components/ui/theme';
import { Page } from '@/components/shell/Page';
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
  const colors = useThemeColors();
  return (
    <View className="mx-auto w-full max-w-[440px] items-center gap-5 py-8">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name="libraries" size={28} color={colors.accent} />
      </View>
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-center text-lg font-sans-bold text-ink">
          Create your first library
        </Text>
        <Text className="text-center text-base leading-6 text-muted">
          Keep books and audiobooks together, then choose who can read them. Start with a name, like
          Family or Kids.
        </Text>
      </View>
      <View className="w-full">
        <CreateLibraryForm {...props} />
      </View>
    </View>
  );
}

/**
 * One row per library: identity and access at a glance, book/member counts,
 * a direct settings shortcut for managers (skips the book catalog most taps
 * here are headed for), and — only when there's more than one library — a
 * star to say which one the app should open to by default.
 */
function LibraryRow({
  item,
  canSwitchPrimary,
  canManage,
  settingPrimary,
  onOpen,
  onManage,
  onSetPrimary,
}: {
  item: Library;
  canSwitchPrimary: boolean;
  canManage: boolean;
  settingPrimary: boolean;
  onOpen: () => void;
  onManage: () => void;
  onSetPrimary: () => void;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const workLabel = `${item.work_count} ${item.work_count === 1 ? 'book' : 'books'}`;
  const memberLabel = `${item.member_count} ${item.member_count === 1 ? 'member' : 'members'}`;

  return (
    <View className="flex-row items-center gap-3 border-b border-line-subtle py-3.5">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${item.name}, ${workLabel}, ${memberLabel}`}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={onOpen}
        className={`min-h-11 min-w-0 flex-1 flex-row items-center gap-3 rounded-control ${stateClass}`}
      >
        <View className="h-11 w-11 flex-none items-center justify-center rounded-full bg-accent-soft">
          <AppIcon name="libraries" size={18} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text numberOfLines={1} className="font-sans-semibold text-base text-ink">
              {item.name}
            </Text>
            {item.primary ? <AppIcon name="starFilled" size={14} color={colors.accent} /> : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="text-xs font-sans-semibold text-subtle">
              {item.role || 'Administrator access'}
            </Text>
            {item.exclusive ? (
              <Text className="text-xs text-subtle">· Restricted access</Text>
            ) : null}
          </View>
          <Text className="text-xs text-muted">
            {workLabel} · {memberLabel}
          </Text>
        </View>
      </Pressable>
      {canSwitchPrimary ? (
        <IconButton
          icon={item.primary ? 'starFilled' : 'starOutline'}
          label={
            item.primary
              ? `${item.name} is your primary library`
              : `Make ${item.name} your primary library`
          }
          kind="quiet"
          disabled={settingPrimary}
          onPress={onSetPrimary}
        />
      ) : null}
      {canManage ? (
        <IconButton icon="settings" label={`Manage ${item.name}`} kind="quiet" onPress={onManage} />
      ) : null}
      <AppIcon name="chevron" size={16} color={colors.subtle} />
    </View>
  );
}

export default function Libraries() {
  const auth = useAuth();
  const [items, setItems] = useState<Library[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const [offline, setOffline] = useState(false);
  const [settingPrimaryID, setSettingPrimaryID] = useState('');
  const primarySavePending = useRef(false);
  const [manageTarget, setManageTarget] = useState<Library | null>(null);

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

  function manageLibrary(library: Library) {
    setManageTarget(library);
  }

  function openManagePanel(panel: 'work' | 'members' | 'policy' | 'settings') {
    const target = manageTarget;
    setManageTarget(null);
    if (!target) return;
    router.push(`/library/${target.id}?open=${panel}`);
  }

  function openManageSources() {
    const target = manageTarget;
    setManageTarget(null);
    if (!target) return;
    router.push(`/sources?libraryId=${target.id}`);
  }

  async function setPrimary(library: Library) {
    if (primarySavePending.current) return;
    primarySavePending.current = true;
    setSettingPrimaryID(library.id);
    setError('');
    try {
      await api.setPrimaryLibrary(library.id);
      setItems((current) => current.map((item) => ({ ...item, primary: item.id === library.id })));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      primarySavePending.current = false;
      setSettingPrimaryID('');
    }
  }

  async function handleCreate() {
    if (busy || !name.trim()) return;
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

  const primaryLibrary = items.find((item) => item.primary);

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
        <View className="max-w-[720px] gap-1">
          <SectionHeader title="Your libraries" />
          {items.length > 1 && primaryLibrary ? (
            <Text className="text-sm text-muted">
              {primaryLibrary.name} is the default for Library, Sources, and Acquisitions. Star
              another library to change it.
            </Text>
          ) : null}
          <View className="mt-2">
            {items.map((item, index) => (
              <Animated.View key={item.id} entering={listItemEnter(index)}>
                <LibraryRow
                  item={item}
                  canSwitchPrimary={items.length > 1}
                  canManage={Boolean(auth.user?.admin || item.role === 'owner')}
                  settingPrimary={Boolean(settingPrimaryID)}
                  onOpen={() => openLibrary(item)}
                  onManage={() => manageLibrary(item)}
                  onSetPrimary={() => void setPrimary(item)}
                />
              </Animated.View>
            ))}
          </View>
        </View>
      )}
      <Dialog
        visible={createOpen}
        title="Add library"
        sheet
        onClose={() => {
          if (!busy) setCreateOpen(false);
        }}
        footer={
          <Button
            label="Create library"
            kind="primary"
            disabled={busy || !name.trim()}
            loading={busy}
            onPress={() => void handleCreate()}
          />
        }
      >
        <View className="gap-4">
          {createError ? <Notice danger>{createError}</Notice> : null}
          <TextField
            label="Library name"
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void handleCreate()}
          />
        </View>
      </Dialog>
      <Dialog
        sheet
        visible={Boolean(manageTarget)}
        title={manageTarget ? `Manage ${manageTarget.name}` : 'Manage library'}
        onClose={() => setManageTarget(null)}
      >
        <View>
          <ManagementRow icon="add" label="Add work" onPress={() => openManagePanel('work')} />
          <ManagementRow icon="users" label="Members" onPress={() => openManagePanel('members')} />
          <ManagementRow icon="folder" label="Sources" onPress={openManageSources} />
          <ManagementRow
            icon="acquire"
            label="Acquisition policy"
            onPress={() => openManagePanel('policy')}
          />
          <ManagementRow
            icon="settings"
            label="Library settings"
            onPress={() => openManagePanel('settings')}
          />
        </View>
      </Dialog>
    </Page>
  );
}
