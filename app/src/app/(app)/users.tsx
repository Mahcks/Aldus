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

const emptyForm = { username: '', display_name: '', password: '', admin: false };
const MIN_PASSWORD_LENGTH = 12;

export default function UsersScreen() {
  const auth = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<User>();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
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
  const passwordTooShort = form.password.length > 0 && form.password.length < MIN_PASSWORD_LENGTH;
  const canSubmit = form.username.trim().length > 0 && form.password.length >= MIN_PASSWORD_LENGTH;

  async function createUser() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.createUser(form);
      setForm(emptyForm);
      setCreateOpen(false);
      setSuccess('Account created.');
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
                  <Text numberOfLines={1} className="font-bold text-ink">
                    {user.display_name || user.username}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-muted">
                    @{user.username}
                  </Text>
                </View>
                <Row>
                  {user.admin ? <StatusBadge tone="info" label="Admin" /> : null}
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
          />
          <Field
            label="Display name"
            value={form.display_name}
            onChangeText={(display_name) => setForm((current) => ({ ...current, display_name }))}
          />
          <Field
            label="Temporary password"
            secureTextEntry
            value={form.password}
            onChangeText={(password) => setForm((current) => ({ ...current, password }))}
            help={passwordTooShort ? undefined : 'Use at least 12 characters.'}
            error={
              passwordTooShort
                ? `Add ${MIN_PASSWORD_LENGTH - form.password.length} more characters.`
                : undefined
            }
          />
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
              <Text numberOfLines={2} className="text-lg font-bold text-ink">
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
            </Row>
            <Notice tone="info">
              Disabling an account also revokes its active sessions. Library roles are managed from
              each Library.
            </Notice>
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
                <Text className="text-xs font-semibold text-muted">Account ID</Text>
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
    </Page>
  );
}
