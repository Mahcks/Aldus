import type { Library, Membership, User, WorkSummary } from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { BrowseControls, WorkGrid } from '../../../features/browse';
import { useAuth } from '../../../features/auth/AuthProvider';
import { AppIcon, type AppIconName } from '../../../features/icons';
import { Pressable, Text, View } from '../../../features/tw';
import {
  Button,
  colors,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Notice,
  Page,
  Radio,
  Row,
  shared,
} from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

type Panel = 'work' | 'members' | 'settings' | null;
type Role = 'owner' | 'editor' | 'reader';

const roles: Role[] = ['owner', 'editor', 'reader'];

/** Quiet row inside the compact mobile "Library management" sheet. */
function ManagementRow({
  icon,
  label,
  onPress,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-11 flex-row items-center gap-3 border-b border-line-subtle py-3"
    >
      <AppIcon name={icon} size={18} color={colors.muted} />
      <Text className="flex-1 text-base font-semibold text-ink">{label}</Text>
      <AppIcon name="chevron" size={18} color={colors.subtle} />
    </Pressable>
  );
}

export default function LibraryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const compact = useWindowDimensions().width < 600;
  const [library, setLibrary] = useState<Library>();
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [availability, setAvailability] = useState('all');
  const [hasMore, setHasMore] = useState(false);
  const [loadingWorks, setLoadingWorks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [memberID, setMemberID] = useState('');
  const [role, setRole] = useState<Role>('reader');
  const [removeTarget, setRemoveTarget] = useState<Membership | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingLibrary, setDeletingLibrary] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const [nextLibrary, nextMembers, nextUsers] = await Promise.all([
        api.library(id),
        api.members(id),
        auth.user?.admin ? api.users() : Promise.resolve([]),
      ]);
      setLibrary(nextLibrary);
      setName(nextLibrary.name);
      setMembers(nextMembers);
      setUsers(nextUsers);
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

  async function loadWorks(offset = 0) {
    if (!id) return;
    setLoadingWorks(true);
    try {
      const page = await api.browseWorks({
        libraryID: id,
        q: query,
        sort,
        availability,
        limit: 24,
        offset,
      });
      setWorks((current) => (offset ? [...current, ...page.items] : page.items));
      setHasMore(page.has_more);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoadingWorks(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void loadWorks(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query, sort, availability]);

  if (loading) return <Loading />;
  if (!library)
    return (
      <Page title="Library">
        <Notice danger>{error || 'Library unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(
    auth.user?.admin || library.role === 'owner' || library.role === 'editor',
  );
  const canManage = Boolean(auth.user?.admin || library.role === 'owner');
  const hasManagementActions = canManage || canEdit;
  const filtersActive = Boolean(query || availability !== 'all');
  const availableUsers = users.filter(
    (user) => !user.disabled && !members.some((member) => member.user_id === user.id),
  );

  function closePanel() {
    setPanel(null);
  }

  function openPanelFromManage(next: Exclude<Panel, null>) {
    setManageOpen(false);
    setPanel(next);
  }

  function openSourcesFromManage() {
    setManageOpen(false);
    router.push(`/sources?libraryId=${id}`);
  }

  function clearFilters() {
    setQuery('');
    setAvailability('all');
  }

  async function createWork() {
    try {
      const work = await api.createWork(id, { title, author });
      setPanel(null);
      setTitle('');
      setAuthor('');
      router.push(`/work/${work.id}?libraryId=${id}&role=${library?.role || ''}`);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function saveName() {
    try {
      await api.updateLibrary(id, { name });
      setPanel(null);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function saveMember() {
    try {
      await api.setMember(id, memberID, role);
      setMemberID('');
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function changeMemberRole(member: Membership, next: Role) {
    try {
      await api.setMember(id, member.user_id, next);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    setRemovingMember(true);
    try {
      await api.removeMember(id, removeTarget.user_id);
      setRemoveTarget(null);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setRemovingMember(false);
    }
  }

  async function confirmDeleteLibrary() {
    setDeletingLibrary(true);
    try {
      await api.deleteLibrary(id);
      router.replace('/libraries');
    } catch (value) {
      setError(errorMessage(value));
      setDeletingLibrary(false);
    }
  }

  return (
    <Page
      title={library.name}
      back={
        <Button label="Libraries" icon="back" kind="quiet" onPress={() => goBackOr('/libraries')} />
      }
      actions={
        compact ? undefined : (
          <Row>
            {canManage ? (
              <Button label="Members" kind="quiet" onPress={() => setPanel('members')} />
            ) : null}
            {canEdit ? (
              <Button
                label="Sources"
                kind="quiet"
                onPress={() => router.push(`/sources?libraryId=${id}`)}
              />
            ) : null}
            {canManage ? (
              <IconButton
                icon="settings"
                label="Library settings"
                kind="quiet"
                onPress={() => setPanel('settings')}
              />
            ) : null}
            {canEdit ? (
              <Button label="Add work" icon="add" kind="primary" onPress={() => setPanel('work')} />
            ) : null}
          </Row>
        )
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <View>
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-sm text-muted">
            {works.length} {works.length === 1 ? 'work' : 'works'} shown · {members.length}{' '}
            {members.length === 1 ? 'member' : 'members'}
          </Text>
          {compact && hasManagementActions ? (
            <IconButton
              icon="more"
              label="Library management"
              kind="quiet"
              onPress={() => setManageOpen(true)}
            />
          ) : null}
        </View>
        <View className="mt-4">
          <BrowseControls
            query={query}
            sort={sort}
            availability={availability}
            onQueryChange={setQuery}
            onSortChange={setSort}
            onAvailabilityChange={setAvailability}
          />
        </View>
        <View className="mt-6">
          {loadingWorks && works.length === 0 ? (
            <Loading label="Finding books…" />
          ) : works.length === 0 && filtersActive ? (
            <EmptyState
              icon="search"
              title="No matching works"
              action={<Button label="Clear search and filters" onPress={clearFilters} />}
            >
              Try another title, author, or availability filter.
            </EmptyState>
          ) : works.length === 0 ? (
            <EmptyState
              icon="read"
              title="Your library is empty"
              action={
                canEdit ? (
                  <Button
                    label="Add your first work"
                    kind="primary"
                    onPress={() => setPanel('work')}
                  />
                ) : undefined
              }
            >
              Add a book or audiobook to start building this shelf.
            </EmptyState>
          ) : (
            <View className="items-start gap-6">
              <WorkGrid
                works={works}
                onOpen={(work) =>
                  router.push(`/work/${work.id}?libraryId=${id}&role=${library.role}`)
                }
              />
              {hasMore ? (
                <Button
                  label={loadingWorks ? 'Loading…' : 'Load more'}
                  disabled={loadingWorks}
                  onPress={() => void loadWorks(works.length)}
                />
              ) : null}
            </View>
          )}
        </View>
      </View>
      <Dialog visible={manageOpen} title="Library management" onClose={() => setManageOpen(false)}>
        <View>
          {canEdit ? (
            <ManagementRow
              icon="add"
              label="Add work"
              onPress={() => openPanelFromManage('work')}
            />
          ) : null}
          {canManage ? (
            <ManagementRow
              icon="users"
              label="Members"
              onPress={() => openPanelFromManage('members')}
            />
          ) : null}
          {canEdit ? (
            <ManagementRow icon="folder" label="Sources" onPress={openSourcesFromManage} />
          ) : null}
          {canManage ? (
            <ManagementRow
              icon="settings"
              label="Library settings"
              onPress={() => openPanelFromManage('settings')}
            />
          ) : null}
        </View>
      </Dialog>
      <Dialog visible={panel === 'work'} title="Add work" onClose={closePanel}>
        <View className={shared.form}>
          <Field label="Title" autoFocus value={title} onChangeText={setTitle} />
          <Field label="Author" value={author} onChangeText={setAuthor} />
          <Row>
            <Button label="Cancel" onPress={closePanel} />
            <Button
              label="Create work"
              kind="primary"
              disabled={!title.trim()}
              onPress={createWork}
            />
          </Row>
        </View>
      </Dialog>
      <Dialog visible={panel === 'members'} title="Manage members" onClose={closePanel} wide>
        <View className="gap-1">
          {members.map((member) => (
            <View
              key={member.user_id}
              className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3.5"
            >
              <View className="min-w-[160px] flex-1 gap-1">
                <Text className={shared.itemTitle}>{member.display_name || member.username}</Text>
                <Text className={shared.itemMeta}>@{member.username}</Text>
              </View>
              <RoleControl
                value={member.role as Role}
                onChange={(next) => void changeMemberRole(member, next)}
              />
              <Button label="Remove" kind="danger" onPress={() => setRemoveTarget(member)} />
            </View>
          ))}
          {auth.user?.admin ? (
            <View className="gap-3 pt-6">
              <Text className="text-sm font-extrabold text-ink">Add member</Text>
              <View className="gap-1">
                {availableUsers.map((user) => (
                  <Radio
                    key={user.id}
                    label={`${user.display_name || user.username} · @${user.username}`}
                    selected={memberID === user.id}
                    onPress={() => setMemberID(user.id)}
                  />
                ))}
              </View>
              <RoleControl value={role} onChange={setRole} />
              <Button label="Add member" kind="primary" disabled={!memberID} onPress={saveMember} />
            </View>
          ) : (
            <Notice>
              Only a global administrator can add a new account. You can change roles or remove
              existing members here.
            </Notice>
          )}
        </View>
      </Dialog>
      <Dialog visible={panel === 'settings'} title="Library settings" onClose={closePanel}>
        <View className={shared.form}>
          <Field label="Library name" value={name} onChangeText={setName} />
          <Button label="Save changes" kind="primary" disabled={!name.trim()} onPress={saveName} />
          <View className="mt-4 gap-2 border-t border-line pt-4">
            <Text className="text-sm font-extrabold text-ink">Delete library</Text>
            <Text className={shared.itemMeta}>
              The library must contain no works before it can be deleted.
            </Text>
            <Button
              label="Delete library"
              kind="danger"
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        </View>
      </Dialog>
      <ConfirmDialog
        visible={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void confirmRemoveMember()}
        title="Remove member?"
        description={`${
          removeTarget?.display_name || removeTarget?.username
        } will lose access to this library. They can be re-added later.`}
        confirmLabel="Remove"
        danger
        busy={removingMember}
      />
      <ConfirmDialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void confirmDeleteLibrary()}
        title="Delete library?"
        description="This cannot be undone. The library must contain no works before it can be deleted."
        confirmLabel="Delete"
        danger
        busy={deletingLibrary}
      />
    </Page>
  );
}

function RoleControl({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-1.5">
      {roles.map((item) => (
        <RolePill
          key={item}
          label={item}
          selected={value === item}
          onPress={() => onChange(item)}
        />
      ))}
    </View>
  );
}

function RolePill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const borderClass = selected ? 'border-accent bg-accent-soft' : 'border-line-strong bg-paper';
  const textClass = selected ? 'text-accent-strong' : 'text-muted';

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      className={`min-h-9 items-center justify-center rounded-control border px-2.5 py-1.5 ${borderClass}`}
    >
      <Text className={`text-xs font-bold capitalize ${textClass}`}>{label}</Text>
    </Pressable>
  );
}
