import type { Library, Membership, User } from '@/generated/api';
import { useEffect, useRef, useState } from 'react';
import { Platform, Share, useWindowDimensions } from 'react-native';
import { getAPIBaseURL } from '@/lib/api-base';
import { useAuth } from '@/features/auth/AuthProvider';
import { Text, View } from '@/features/tw';
import {
  libraryAccessCountLabel,
  libraryAccessSummary,
  membershipForUser,
} from '@/features/user-library-access';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Notice,
  Page,
  Row,
  SearchField,
  StatusBadge,
} from '@/features/ui';
import { api, errorMessage } from '@/lib/api';
import { LibraryAccessEditor } from '@/features/LibraryAccessEditor';

const emptyForm = { username: '', display_name: '', admin_note: '', admin: false };
export default function UsersScreen() {
  const auth = useAuth();
  const desktop = useWindowDimensions().width >= 1100;
  const [users, setUsers] = useState<User[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [membersByLibrary, setMembersByLibrary] = useState<Record<string, Membership[]>>({});
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<User>();
  const [createOpen, setCreateOpen] = useState(false);
  const [createLibraryIDs, setCreateLibraryIDs] = useState<string[]>([]);
  const [allowRequests, setAllowRequests] = useState(false);
  const [grantErrors, setGrantErrors] = useState<string[]>([]);
  const [roleConfirm, setRoleConfirm] = useState(false);
  const accessLock = useRef(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [temporaryCredential, setTemporaryCredential] = useState<{
    username: string;
    password: string;
    userID: string;
  }>();
  const [noteOpen, setNoteOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState('');
  const [accessError, setAccessError] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
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

  const serverAddress =
    getAPIBaseURL() || (typeof window !== 'undefined' ? window.location.origin : '');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleUsers = users.filter((user) =>
    `${user.display_name} ${user.username} ${user.admin_note ?? ''}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
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
        userID: created.user.id,
      });
      await grantInitialAccess(created.user.id);
      setSuccess('Account created. Review library access before sharing the sign-in details.');
      await loadUsers();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function grantInitialAccess(userID: string) {
    const failures: string[] = [];
    for (const libraryID of createLibraryIDs) {
      try {
        await api.setMember(libraryID, userID, 'reader', allowRequests, false, false, false);
      } catch {
        failures.push(
          libraries.find((library) => library.id === libraryID)?.name || 'Selected library',
        );
      }
    }
    setGrantErrors(failures);
    await loadLibraryAccess();
  }

  async function changeAdministrator() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.updateUser(selected.id, { admin: !selected.admin });
      setRoleConfirm(false);
      await loadUsers();
      if (selected.id === auth.user?.id) await auth.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function retryInitialAccess() {
    if (!temporaryCredential || busy) return;
    setBusy(true);
    try {
      await grantInitialAccess(temporaryCredential.userID);
    } finally {
      setBusy(false);
    }
  }

  async function shareSignIn() {
    if (!temporaryCredential) return;
    const message = `Sign in to Aldus: ${serverAddress}
Username: ${temporaryCredential.username}
Temporary password: ${temporaryCredential.password}
Choose your own password when you sign in.`;
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(message);
        setSuccess('Sign-in details copied.');
      } else {
        await Share.share({ message });
      }
    } catch {
      setError('Could not share automatically. Select and copy the details below.');
    }
  }

  async function resetPassword() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const reset = await api.resetUserPassword(selected.id);
      setConfirmingReset(false);
      setTemporaryCredential({
        username: selected.username,
        password: reset.temporary_password,
        userID: selected.id,
      });
      setGrantErrors([]);
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

  async function saveAdminNote() {
    if (!selected || savingNote) return;
    const note = adminNote.trim();
    setSavingNote(true);
    setNoteError('');
    setNoteSaved(false);
    try {
      await api.updateUser(selected.id, { admin_note: note });
      setAdminNote(note);
      setSelected((current) => (current ? { ...current, admin_note: note } : current));
      setUsers((current) =>
        current.map((user) => (user.id === selected.id ? { ...user, admin_note: note } : user)),
      );
      setNoteSaved(true);
    } catch (value) {
      setNoteError(errorMessage(value));
    } finally {
      setSavingNote(false);
    }
  }

  function selectedMembership(libraryID: string) {
    return selected ? membershipForUser(membersByLibrary, libraryID, selected.id) : undefined;
  }

  async function changeLibraryRole(library: Library, role: string) {
    if (!selected || accessLock.current) return;
    const membership = selectedMembership(library.id);
    if (membership?.role === role || (!membership && !role)) return;
    accessLock.current = true;
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
      accessLock.current = false;
      setAccessBusy('');
    }
  }

  async function toggleLibraryPermission(
    library: Library,
    permission: 'request' | 'bypass' | 'advanced' | 'exclusive',
  ) {
    const membership = selectedMembership(library.id);
    if (!selected || !membership || accessLock.current) return;
    accessLock.current = true;
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
      accessLock.current = false;
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
      title={selected && !desktop ? selected.display_name || selected.username : 'Family & users'}
      back={
        selected ? (
          <IconButton
            icon="back"
            label="Back to users"
            kind="quiet"
            onPress={() => setSelected(undefined)}
          />
        ) : undefined
      }
      actions={
        selected && !desktop ? undefined : (
          <Button
            label="Add user"
            icon="add"
            kind="primary"
            onPress={() => {
              setError('');
              setGrantErrors([]);
              setCreateOpen(true);
            }}
          />
        )
      }
      editorial={false}
    >
      {error ? <Notice danger>{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
      <View className={desktop ? 'flex-row items-start gap-8' : ''}>
        {!selected || desktop ? (
          <View
            className={
              selected && desktop ? 'w-[300px] shrink-0 gap-4' : 'w-full max-w-[900px] gap-4'
            }
          >
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
                    <View className="h-11 w-11 items-center justify-center rounded-full bg-neutral-soft">
                      <Text className="text-lg font-sans-medium text-ink">
                        {(user.display_name || user.username).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View className="min-w-[140px] flex-1">
                      <Text numberOfLines={1} className="font-sans-bold text-ink">
                        {user.display_name || user.username}
                      </Text>
                      <Text numberOfLines={1} className="text-sm text-muted">
                        @{user.username}
                      </Text>
                      {user.admin_note ? (
                        <Text numberOfLines={1} className="mt-1 text-xs text-subtle">
                          {user.admin_note}
                        </Text>
                      ) : null}
                    </View>
                    <Row>
                      {!accessLoading ? (
                        <StatusBadge
                          label={
                            user.admin &&
                            !libraryAccessSummary(membersByLibrary, user.id).hasExclusiveAccess
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
                          setError('');
                          setSuccess('');
                          setTechnicalOpen(false);
                          setNoteOpen(false);
                          setAccessError('');
                          setAdminNote(user.admin_note ?? '');
                          setNoteError('');
                          setNoteSaved(false);
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
        ) : null}

        <Dialog
          visible={createOpen}
          title="Add user"
          sheet
          onClose={() => {
            if (!busy) setCreateOpen(false);
          }}
          footer={
            <Button
              label="Create account"
              kind="primary"
              loading={busy}
              disabled={!canSubmit || accessLoading || (!form.admin && !createLibraryIDs.length)}
              onPress={() => void createUser()}
            />
          }
        >
          <View className="gap-3">
            {error ? <Notice danger>{error}</Notice> : null}
            <Field
              label="Username"
              autoFocus
              autoCapitalize="none"
              value={form.username}
              onChangeText={(username) => setForm((current) => ({ ...current, username }))}
              help="They can change this when they first sign in."
            />
            <Field
              label="Display name"
              value={form.display_name}
              onChangeText={(display_name) => setForm((current) => ({ ...current, display_name }))}
            />
            <Field
              label="Admin note"
              value={form.admin_note}
              onChangeText={(admin_note) => setForm((current) => ({ ...current, admin_note }))}
              help="Optional. Only administrators can see this note."
              maxLength={500}
              multiline
              numberOfLines={3}
            />
            <Notice>
              Aldus generates a one-time password. The reader chooses their final username and
              password when they first sign in.
            </Notice>
            <Text className="font-sans-bold text-base text-ink">Books they can access</Text>
            {accessLoading ? <Loading label="Loading libraries…" /> : null}
            {libraries.map((library) => (
              <Checkbox
                key={library.id}
                label={library.name}
                checked={createLibraryIDs.includes(library.id)}
                disabled={busy}
                onPress={() =>
                  setCreateLibraryIDs((ids) =>
                    ids.includes(library.id)
                      ? ids.filter((id) => id !== library.id)
                      : [...ids, library.id],
                  )
                }
              />
            ))}
            {accessError ? <Notice danger>{accessError}</Notice> : null}
            {!createLibraryIDs.length ? (
              <Text className="text-sm text-muted">
                Choose at least one library for a reader to start with books.
              </Text>
            ) : null}
            <Checkbox
              label="Allow book requests (approval required)"
              checked={allowRequests}
              onPress={() => setAllowRequests((value) => !value)}
            />
            <Checkbox
              label="Grant global administrator access"
              checked={form.admin}
              onPress={() => setForm((current) => ({ ...current, admin: !current.admin }))}
            />
          </View>
        </Dialog>

        {selected ? (
          <View
            className={
              desktop ? 'min-w-0 flex-1 gap-6 border-l border-line-subtle pl-8' : 'w-full gap-6'
            }
          >
            {desktop ? (
              <Text accessibilityRole="header" className="text-2xl font-sans-semibold text-ink">
                {selected.display_name || selected.username}
              </Text>
            ) : null}
            <View>
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
                {selectedAccess.hasExclusiveAccess
                  ? 'This administrator is limited to the libraries marked for exclusive access.'
                  : 'This administrator can access and manage every library.'}
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
                  Choose what this person can access. Changes save automatically.
                </Text>
              </View>
              {accessError ? <Notice danger>{accessError}</Notice> : null}
              {selectedAccess.hasExclusiveAccess ? (
                <Notice tone="info">
                  This account is limited to libraries marked “Include in exclusive access.” Other
                  direct roles are retained but cannot open their libraries.
                </Notice>
              ) : null}
              {accessLoading ? (
                <Loading label="Loading library access…" />
              ) : libraries.length ? (
                <View>
                  {libraries.map((library) => {
                    const membership = selectedMembership(library.id);
                    const lastOwner =
                      membership?.role === 'owner' &&
                      membersByLibrary[library.id]?.filter(
                        (member) =>
                          member.role === 'owner' &&
                          !users.find((user) => user.id === member.user_id)?.disabled,
                      ).length === 1;
                    return (
                      <LibraryAccessEditor
                        key={library.id}
                        library={library}
                        membership={membership}
                        administrator={selected.admin}
                        exclusive={selectedAccess.hasExclusiveAccess}
                        lastOwner={Boolean(lastOwner)}
                        disabled={selected.disabled || Boolean(accessBusy)}
                        saving={accessBusy === library.id}
                        multipleLibraries={libraries.length > 1}
                        onRoleChange={(role) => void changeLibraryRole(library, role)}
                        onPermissionChange={(permission) =>
                          void toggleLibraryPermission(library, permission)
                        }
                      />
                    );
                  })}
                </View>
              ) : (
                <EmptyState icon="libraries" title="No libraries">
                  Create a library before assigning access.
                </EmptyState>
              )}
            </View>
            <View className="gap-3 border-t border-line pt-5">
              <Text className="text-base font-sans-bold text-ink">Account settings</Text>
              <Text className="text-sm text-muted">
                Manage sign-in and who can administer your server.
              </Text>
              <Row>
                <Button
                  label={selected.admin ? 'Remove administrator access' : 'Make administrator'}
                  kind="secondary"
                  onPress={() => {
                    setError('');
                    setRoleConfirm(true);
                  }}
                />
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
              </Row>
            </View>
            <View className="gap-3 border-t border-line pt-3">
              <View className="self-start">
                <Button
                  label={
                    noteOpen
                      ? 'Hide private note'
                      : selected.admin_note
                        ? 'Edit private note'
                        : 'Add private note'
                  }
                  kind="quiet"
                  onPress={() => setNoteOpen((open) => !open)}
                />
              </View>
              {noteOpen ? (
                <View className="gap-3">
                  <Field
                    label="Admin note"
                    value={adminNote}
                    onChangeText={(value) => {
                      setAdminNote(value);
                      setNoteSaved(false);
                    }}
                    help="Only global administrators can see this note."
                    maxLength={500}
                    multiline
                    numberOfLines={3}
                  />
                  {noteError ? <Notice danger>{noteError}</Notice> : null}
                  {noteSaved ? (
                    <Text accessibilityLiveRegion="polite" className="text-sm text-success">
                      Note saved.
                    </Text>
                  ) : null}
                  <View className="self-start">
                    <Button
                      label="Save note"
                      kind="secondary"
                      loading={savingNote}
                      disabled={adminNote.trim() === (selected.admin_note ?? '')}
                      onPress={() => void saveAdminNote()}
                    />
                  </View>
                </View>
              ) : null}
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
      </View>
      <Dialog
        visible={roleConfirm}
        title="Change administrator access"
        onClose={() => {
          if (!busy) setRoleConfirm(false);
        }}
      >
        {error ? <Notice danger>{error}</Notice> : null}
        <Text className="text-base text-ink">
          {selected?.admin
            ? 'This account will become a member. Its books, progress and collections stay with the same account.'
            : 'Administrators can manage accounts, server settings and libraries. Only grant this to someone you trust to manage the household server.'}
        </Text>
        <Button
          label="Confirm role change"
          kind="primary"
          loading={busy}
          onPress={() => void changeAdministrator()}
        />
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
        description={
          error ||
          `This signs ${selected?.display_name || selected?.username} out of Aldus apps and browsers and creates a new temporary password. KOReader and OPDS credentials stay connected.`
        }
        confirmLabel="Reset password"
        busy={busy}
      />
      <Dialog
        visible={Boolean(temporaryCredential)}
        title="One-time sign-in"
        sheet
        footer={
          <Button
            label="I saved it"
            kind="secondary"
            onPress={() => setTemporaryCredential(undefined)}
          />
        }
        onClose={() => setTemporaryCredential(undefined)}
      >
        {temporaryCredential ? (
          <View className="gap-4">
            {error ? <Notice danger>{error}</Notice> : null}
            {success === 'Sign-in details copied.' ? (
              <Notice tone="success">{success}</Notice>
            ) : null}
            {grantErrors.length ? (
              <Notice danger>
                Account created, but access could not be saved for: {grantErrors.join(', ')}. Keep
                these credentials and review access before sharing.
              </Notice>
            ) : null}
            {grantErrors.length ? (
              <Button
                label="Retry library access"
                loading={busy}
                onPress={() => void retryInitialAccess()}
              />
            ) : null}
            <Text selectable className="text-base text-ink">
              {serverAddress}
            </Text>
            <Button
              label={Platform.OS === 'web' ? 'Copy sign-in details' : 'Share sign-in details'}
              kind="primary"
              onPress={() => void shareSignIn()}
            />
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
          </View>
        ) : null}
      </Dialog>
    </Page>
  );
}
