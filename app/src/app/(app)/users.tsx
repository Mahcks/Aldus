import type { Library, Membership, User } from '@/generated/api';
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Text, View } from '@/features/tw';
import {
  libraryAccessCountLabel,
  libraryAccessSummary,
  membershipAccessLabel,
  membershipForUser,
} from '@/features/user-library-access';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  SearchField,
  StatusBadge,
} from '@/features/ui';
import { api, errorMessage } from '@/lib/api';

const emptyForm = { username: '', display_name: '', admin: false };
const libraryRoles = [
  { value: '', label: 'No access' },
  { value: 'reader', label: 'Reader' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner' },
] as const;

export default function UsersScreen() {
  const auth = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [membersByLibrary, setMembersByLibrary] = useState<Record<string, Membership[]>>({});
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<User>();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [temporaryCredential, setTemporaryCredential] = useState<{
    username: string;
    password: string;
  }>();
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState('');
  const [accessError, setAccessError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadUsers() {
    try {
      const items: User[] = [];
      for (;;) {
        const page = await api.users(items.length);
        items.push(...page);
        if (page.length < 100) break;
      }
      setUsers(items);
      setSelected((current) => items.find((item) => item.id === current?.id));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  async function loadLibraryAccess() {
    setAccessLoading(true);
    setAccessError('');
    try {
      const items: Library[] = [];
      for (;;) {
        const page = await api.libraries(items.length);
        items.push(...page);
        if (page.length < 100) break;
      }
      const memberPages = await Promise.all(items.map((library) => api.members(library.id)));
      setLibraries(items);
      setMembersByLibrary(
        Object.fromEntries(items.map((library, index) => [library.id, memberPages[index]])),
      );
    } catch (value) {
      setAccessError(errorMessage(value));
    } finally {
      setAccessLoading(false);
    }
  }

  useEffect(() => {
    // Data loading is the external synchronization this effect owns.
    if (auth.user?.admin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadUsers();
      void loadLibraryAccess();
    }
  }, [auth.user?.admin]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleUsers = users.filter((user) =>
    `${user.display_name} ${user.username}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const canSubmit = form.username.trim().length >= 3;
  const selectedAccess = selected
    ? libraryAccessSummary(membersByLibrary, selected.id)
    : { count: 0, hasExclusiveAccess: false };

  async function createUser() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.createUser(form);
      setForm(emptyForm);
      setCreateOpen(false);
      setTemporaryCredential({
        username: created.user.username,
        password: created.temporary_password,
      });
      setSuccess('Account created. Share the one-time sign-in details securely.');
      await loadUsers();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const reset = await api.resetUserPassword(selected.id);
      setConfirmingReset(false);
      setTemporaryCredential({ username: selected.username, password: reset.temporary_password });
      setSelected(undefined);
      setSuccess('Password reset. Existing app sessions were revoked.');
      await loadUsers();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSelected() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.updateUser(selected.id, { disabled: !selected.disabled });
      setSuccess(selected.disabled ? 'Account enabled.' : 'Account disabled and sessions revoked.');
      await loadUsers();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  function selectedMembership(libraryID: string) {
    return selected ? membershipForUser(membersByLibrary, libraryID, selected.id) : undefined;
  }

  async function changeLibraryRole(library: Library, role: string) {
    if (!selected || accessBusy) return;
    const membership = selectedMembership(library.id);
    if (membership?.role === role || (!membership && !role)) return;
    setAccessBusy(library.id);
    setAccessError('');
    try {
      if (!role) {
        await api.removeMember(library.id, selected.id);
      } else {
        await api.setMember(
          library.id,
          selected.id,
          role,
          membership?.can_request_acquisitions,
          membership?.can_bypass_acquisition_approval,
          membership?.can_advanced_acquisition_request,
          membership?.exclusive,
        );
      }
      const members = await api.members(library.id);
      setMembersByLibrary((current) => ({ ...current, [library.id]: members }));
    } catch (value) {
      setAccessError(errorMessage(value));
    } finally {
      setAccessBusy('');
    }
  }

  async function toggleLibraryPermission(
    library: Library,
    permission: 'request' | 'bypass' | 'advanced' | 'exclusive',
  ) {
    const membership = selectedMembership(library.id);
    if (!selected || !membership || accessBusy) return;
    setAccessBusy(library.id);
    setAccessError('');
    try {
      await api.setMember(
        library.id,
        selected.id,
        membership.role,
        permission === 'request'
          ? !membership.can_request_acquisitions
          : membership.can_request_acquisitions,
        permission === 'bypass'
          ? !membership.can_bypass_acquisition_approval
          : membership.can_bypass_acquisition_approval,
        permission === 'advanced'
          ? !membership.can_advanced_acquisition_request
          : membership.can_advanced_acquisition_request,
        permission === 'exclusive' ? !membership.exclusive : membership.exclusive,
      );
      const members = await api.members(library.id);
      setMembersByLibrary((current) => ({ ...current, [library.id]: members }));
    } catch (value) {
      setAccessError(errorMessage(value));
    } finally {
      setAccessBusy('');
    }
  }

  if (!auth.user?.admin)
    return (
      <Page title="Users" editorial={false}>
        <Notice tone="info">This page is available to global administrators.</Notice>
      </Page>
    );

  return (
    <Page
      title="Users"
      actions={
        <Button label="Add user" icon="add" kind="primary" onPress={() => setCreateOpen(true)} />
      }
      editorial={false}
    >
      {error ? <Notice danger>{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
      <View className="max-w-[900px] gap-4">
        <SearchField
          label="Search users"
          placeholder="Name or username"
          value={query}
          onChangeText={setQuery}
        />
        <Text className="text-sm text-muted">
          {visibleUsers.length} {visibleUsers.length === 1 ? 'account' : 'accounts'}
        </Text>
        {loading ? (
          <Loading label="Loading accounts…" />
        ) : visibleUsers.length ? (
          <View className="border-t border-line">
            {visibleUsers.map((user) => (
              <View
                key={user.id}
                className="min-h-16 flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3"
              >
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-sans-bold text-ink">
                    {user.display_name || user.username}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-muted">
                    @{user.username}
                  </Text>
                </View>
                <Row>
                  {!accessLoading ? (
                    <StatusBadge
                      label={
                        user.admin
                          ? 'All libraries'
                          : libraryAccessCountLabel(membersByLibrary, user.id)
                      }
                    />
                  ) : null}
                  {user.admin ? <StatusBadge tone="info" label="Admin" /> : null}
                  {user.must_change_credentials ? (
                    <StatusBadge tone="warning" label="Setup required" />
                  ) : null}
                  {user.disabled ? (
                    <StatusBadge tone="neutral" label="Disabled" icon="disabled" />
                  ) : null}
                  <Button
                    label="View"
                    kind="quiet"
                    onPress={() => {
                      setTechnicalOpen(false);
                      setAccessError('');
                      setSelected(user);
                    }}
                  />
                </Row>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState icon="users" title={query ? 'No matching users' : 'No accounts'}>
            {query ? 'Try another name or username.' : 'Add an account to get started.'}
          </EmptyState>
        )}
      </View>

      <Dialog visible={createOpen} title="Add user" onClose={() => setCreateOpen(false)}>
        <View className="gap-3">
          <Field
            label="Username"
            autoFocus
            autoCapitalize="none"
            value={form.username}
            onChangeText={(username) => setForm((current) => ({ ...current, username }))}
            help="The reader can change this provisional username during first sign-in."
          />
          <Field
            label="Display name"
            value={form.display_name}
            onChangeText={(display_name) => setForm((current) => ({ ...current, display_name }))}
          />
          <Notice>
            Aldus generates a one-time password. The reader chooses their final username and
            password when they first sign in.
          </Notice>
          <Checkbox
            label="Grant global administrator access"
            checked={form.admin}
            onPress={() => setForm((current) => ({ ...current, admin: !current.admin }))}
          />
          <Row>
            <Button label="Cancel" onPress={() => setCreateOpen(false)} />
            <Button
              label="Create account"
              kind="primary"
              loading={busy}
              disabled={!canSubmit}
              onPress={() => void createUser()}
            />
          </Row>
        </View>
      </Dialog>

      <Dialog
        visible={Boolean(selected)}
        title="User details"
        onClose={() => setSelected(undefined)}
        wide
      >
        {selected ? (
          <View className="gap-5">
            <View>
              <Text numberOfLines={2} className="text-lg font-sans-bold text-ink">
                {selected.display_name || selected.username}
              </Text>
              <Text className="text-sm text-muted">@{selected.username}</Text>
            </View>
            <Row>
              {selected.admin ? (
                <StatusBadge tone="info" label="Global administrator" />
              ) : (
                <StatusBadge label="Member" />
              )}
              <StatusBadge
                tone={selected.disabled ? 'neutral' : 'success'}
                label={selected.disabled ? 'Disabled' : 'Enabled'}
                icon={selected.disabled ? 'disabled' : 'enabled'}
              />
              {selected.must_change_credentials ? (
                <StatusBadge tone="warning" label="Waiting for setup" />
              ) : null}
            </Row>
            {selected.admin ? (
              <Notice tone="info">
                Global administrators can access and manage every library. Direct roles below show
                library ownership records.
              </Notice>
            ) : null}
            {selected.disabled ? (
              <Notice tone="warning">
                Enable this account before changing its library access.
              </Notice>
            ) : null}
            <View className="gap-3 border-t border-line pt-5">
              <View className="gap-1">
                <Text className="text-base font-sans-bold text-ink">Library access</Text>
                <Text className="text-sm text-muted">
                  Readers consume books. Editors manage books and requests. Owners also manage
                  members and library settings.
                </Text>
              </View>
              {accessError ? <Notice danger>{accessError}</Notice> : null}
              {selectedAccess.hasExclusiveAccess && !selected.admin ? (
                <Notice tone="info">
                  This account is limited to libraries marked “Include in exclusive access.” Other
                  direct roles are retained but cannot open their libraries.
                </Notice>
              ) : null}
              {accessLoading ? (
                <Loading label="Loading library access…" />
              ) : libraries.length ? (
                <View className="overflow-hidden rounded-control border border-line">
                  {libraries.map((library, index) => {
                    const membership = selectedMembership(library.id);
                    const lastOwner =
                      membership?.role === 'owner' &&
                      membersByLibrary[library.id]?.filter((member) => member.role === 'owner')
                        .length === 1;
                    const rowBusy = accessBusy === library.id;
                    return (
                      <View
                        key={library.id}
                        className={`gap-3 p-4 ${index ? 'border-t border-line' : ''}`}
                      >
                        <View className="flex-row flex-wrap items-start justify-between gap-3">
                          <View className="min-w-[150px] flex-1 gap-0.5">
                            <Text className="font-sans-bold text-ink">{library.name}</Text>
                            <Text className="text-xs text-muted">
                              {membershipAccessLabel(membership, selectedAccess.hasExclusiveAccess)}
                            </Text>
                          </View>
                          <View
                            accessibilityRole="radiogroup"
                            accessibilityLabel={`${library.name} access`}
                            className="flex-row flex-wrap gap-1.5"
                          >
                            {libraryRoles.map((option) => (
                              <Button
                                key={option.value || 'none'}
                                label={option.label}
                                kind="secondary"
                                selected={(membership?.role ?? '') === option.value}
                                accessibilityRole="radio"
                                disabled={
                                  selected.disabled ||
                                  (lastOwner && option.value !== 'owner') ||
                                  Boolean(accessBusy)
                                }
                                onPress={() => void changeLibraryRole(library, option.value)}
                              />
                            ))}
                          </View>
                        </View>
                        {lastOwner ? (
                          <Text className="text-xs text-muted">
                            Assign another owner before changing this role.
                          </Text>
                        ) : null}
                        {rowBusy ? (
                          <Text accessibilityLiveRegion="polite" className="text-xs text-muted">
                            Saving access…
                          </Text>
                        ) : null}
                        {membership?.role === 'reader' ? (
                          <View className="gap-2 border-t border-line-subtle pt-3">
                            <Text className="text-xs font-sans-semibold text-muted">
                              Request permissions
                            </Text>
                            <View className="flex-row flex-wrap gap-x-5 gap-y-1">
                              <Checkbox
                                label="Can request"
                                checked={membership.can_request_acquisitions}
                                disabled={selected.disabled || Boolean(accessBusy)}
                                onPress={() => void toggleLibraryPermission(library, 'request')}
                              />
                              <Checkbox
                                label="Skip approval"
                                checked={membership.can_bypass_acquisition_approval}
                                disabled={selected.disabled || Boolean(accessBusy)}
                                onPress={() => void toggleLibraryPermission(library, 'bypass')}
                              />
                              <Checkbox
                                label="Advanced release choice"
                                checked={membership.can_advanced_acquisition_request}
                                disabled={selected.disabled || Boolean(accessBusy)}
                                onPress={() => void toggleLibraryPermission(library, 'advanced')}
                              />
                            </View>
                          </View>
                        ) : null}
                        {membership && libraries.length > 1 ? (
                          <View className="border-t border-line-subtle pt-3">
                            <Checkbox
                              label="Include in exclusive access"
                              checked={membership.exclusive}
                              disabled={selected.disabled || Boolean(accessBusy)}
                              onPress={() => void toggleLibraryPermission(library, 'exclusive')}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <EmptyState icon="libraries" title="No libraries">
                  Create a library before assigning access.
                </EmptyState>
              )}
            </View>
            <View className="self-start">
              <Button
                label="Reset password"
                kind="secondary"
                disabled={selected.id === auth.user?.id}
                onPress={() => setConfirmingReset(true)}
              />
              {selected.id === auth.user?.id ? (
                <Text className="mt-2 text-sm text-muted">
                  Change your own password from Account.
                </Text>
              ) : null}
            </View>
            <View className="self-start">
              <Button
                label={selected.disabled ? 'Enable account' : 'Disable account'}
                kind={selected.disabled ? 'secondary' : 'danger'}
                loading={busy}
                onPress={() =>
                  selected.disabled ? void toggleSelected() : setConfirmingDisable(true)
                }
              />
            </View>
            <View className="self-start">
              <Button
                label={technicalOpen ? 'Hide technical details' : 'Technical details'}
                kind="quiet"
                onPress={() => setTechnicalOpen((open) => !open)}
              />
            </View>
            {technicalOpen ? (
              <View className="rounded-control bg-panel p-3">
                <Text className="text-xs font-sans-semibold text-muted">Account ID</Text>
                <Text selectable className="font-mono text-xs text-ink">
                  {selected.id}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Dialog>

      <ConfirmDialog
        visible={confirmingDisable}
        onClose={() => setConfirmingDisable(false)}
        onConfirm={() => {
          setConfirmingDisable(false);
          void toggleSelected();
        }}
        title="Disable account?"
        description={`${
          selected?.display_name || selected?.username
        } will lose access and their active sessions will be revoked immediately.`}
        confirmLabel="Disable"
        danger
        busy={busy}
      />
      <ConfirmDialog
        visible={confirmingReset}
        onClose={() => setConfirmingReset(false)}
        onConfirm={() => void resetPassword()}
        title="Reset password?"
        description={`This signs ${selected?.display_name || selected?.username} out everywhere and creates a new one-time password.`}
        confirmLabel="Reset password"
        busy={busy}
      />
      <Dialog
        visible={Boolean(temporaryCredential)}
        title="One-time sign-in"
        onClose={() => setTemporaryCredential(undefined)}
      >
        {temporaryCredential ? (
          <View className="gap-4">
            <Notice tone="warning">
              Share the library address and these details securely. The password is shown only once
              and must be replaced at first sign-in.
            </Notice>
            <View className="gap-1 rounded-control bg-panel p-3">
              <Text className="text-xs font-sans-semibold text-muted">Username</Text>
              <Text selectable className="font-mono text-sm text-ink">
                {temporaryCredential.username}
              </Text>
            </View>
            <View className="gap-1 rounded-control bg-panel p-3">
              <Text className="text-xs font-sans-semibold text-muted">One-time password</Text>
              <Text selectable className="font-mono text-sm text-ink">
                {temporaryCredential.password}
              </Text>
            </View>
            <View className="self-start">
              <Button
                label="I saved it"
                kind="primary"
                onPress={() => setTemporaryCredential(undefined)}
              />
            </View>
          </View>
        ) : null}
      </Dialog>
    </Page>
  );
}
