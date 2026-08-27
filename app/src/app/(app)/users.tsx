import type { User } from '../../generated/api';
import { useEffect, useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import { Text, View } from '../../features/tw';
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
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

const emptyForm = { username: '', display_name: '', admin: false };

export default function UsersScreen() {
  const auth = useAuth();
  const [users, setUsers] = useState<User[]>([]);
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

  useEffect(() => {
    // Data loading is the external synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (auth.user?.admin) void loadUsers();
  }, [auth.user?.admin]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleUsers = users.filter((user) =>
    `${user.display_name} ${user.username}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const canSubmit = form.username.trim().length >= 3;

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
            <Notice tone="info">
              Disabling an account also revokes its active sessions. Library roles are managed from
              each Library.
            </Notice>
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
