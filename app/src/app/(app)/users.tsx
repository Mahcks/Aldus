import type { User } from '../../generated/api';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { Text, View } from '../../features/tw';
import {
  Button,
  Checkbox,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  StatusBadge,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';
import { goBackOr } from '../../lib/navigation';

const emptyForm = { username: '', display_name: '', password: '', admin: false };
const MIN_PASSWORD_LENGTH = 12;

function AccountRow({
  user,
  onToggleEnabled,
}: {
  user: User;
  onToggleEnabled: (user: User) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const toggleDetails = () => setDetailsExpanded((current) => !current);
  const handleToggleEnabled = () => onToggleEnabled(user);

  return (
    <View className="gap-2.5 border-b border-line py-4">
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-0 gap-0.5">
          <Text className="text-base font-bold text-ink">{user.display_name || user.username}</Text>
          <Text className="text-sm text-muted">@{user.username}</Text>
        </View>
        <Row>
          {user.admin ? (
            <StatusBadge tone="info" label="Administrator" />
          ) : (
            <Text className="text-xs font-semibold text-muted">Member</Text>
          )}
          <StatusBadge
            tone={user.disabled ? 'neutral' : 'success'}
            label={user.disabled ? 'Disabled' : 'Enabled'}
          />
        </Row>
      </View>
      <Row>
        <Button
          label={user.disabled ? 'Enable account' : 'Disable account'}
          kind="secondary"
          onPress={handleToggleEnabled}
        />
        <Button
          label={detailsExpanded ? 'Hide technical details' : 'Technical details'}
          kind="quiet"
          onPress={toggleDetails}
        />
      </Row>
      {detailsExpanded ? (
        <View className="gap-1 rounded-control bg-panel p-3">
          <Text className="text-xs font-semibold text-muted">Account ID</Text>
          <Text selectable className="font-mono text-xs text-muted">
            {user.id}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function UsersScreen() {
  const auth = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();

  const isWideLayout = width >= 900;
  const passwordTooShort = form.password.length > 0 && form.password.length < MIN_PASSWORD_LENGTH;
  const canSubmit = form.username.trim().length > 0 && form.password.length >= MIN_PASSWORD_LENGTH;

  async function loadUsers() {
    try {
      setUsers(await api.users());
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (auth.user?.admin) void loadUsers();
  }, [auth.user?.admin]);

  const change = (key: 'username' | 'display_name' | 'password') => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleAdmin = () => setForm((current) => ({ ...current, admin: !current.admin }));

  async function createUser() {
    try {
      await api.createUser(form);
      setForm(emptyForm);
      await loadUsers();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function toggleUser(user: User) {
    try {
      await api.updateUser(user.id, { disabled: !user.disabled });
      await loadUsers();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  if (!auth.user?.admin)
    return (
      <Page
        title="Users"
        back={
          <Button
            label="Libraries"
            icon="back"
            kind="quiet"
            onPress={() => goBackOr('/libraries')}
          />
        }
      >
        <View className="max-w-[560px] gap-2 rounded-card border border-line bg-panel p-4">
          <Notice tone="info">This page is available to global administrators.</Notice>
        </View>
      </Page>
    );

  return (
    <Page
      title="Users"
      back={
        <Button label="Libraries" icon="back" kind="quiet" onPress={() => goBackOr('/libraries')} />
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <View className={isWideLayout ? 'flex-row items-start gap-8' : 'flex-col gap-8'}>
        <View className={isWideLayout ? 'min-w-0 flex-1' : ''}>
          <Section title="Accounts">
            {loading ? (
              <Loading />
            ) : users.length === 0 ? (
              <Empty>No accounts.</Empty>
            ) : (
              users.map((user) => (
                <AccountRow key={user.id} user={user} onToggleEnabled={toggleUser} />
              ))
            )}
          </Section>
        </View>
        <View className={isWideLayout ? 'w-[380px] shrink-0' : ''}>
          <Section title="Create account">
            <View className="max-w-[560px] gap-3">
              <Field
                label="Username"
                autoCapitalize="none"
                value={form.username}
                onChangeText={change('username')}
              />
              <Field
                label="Display name"
                value={form.display_name}
                onChangeText={change('display_name')}
              />
              <Field
                label="Password"
                secureTextEntry
                value={form.password}
                onChangeText={change('password')}
                help={passwordTooShort ? undefined : 'Use at least 12 characters.'}
                error={
                  passwordTooShort
                    ? `Add ${MIN_PASSWORD_LENGTH - form.password.length} more character${
                        MIN_PASSWORD_LENGTH - form.password.length === 1 ? '' : 's'
                      }.`
                    : undefined
                }
              />
              <View className="gap-1.5">
                <Checkbox
                  label="Grant global administrator access"
                  checked={form.admin}
                  onPress={toggleAdmin}
                />
                <Text className="text-xs leading-4 text-muted">
                  Global administrators can manage every library, source, and user account —
                  including creating and disabling other administrators.
                </Text>
              </View>
              <Button
                label="Create account"
                kind="primary"
                disabled={!canSubmit}
                onPress={createUser}
              />
              {!canSubmit ? (
                <Text className="text-xs text-muted">
                  Enter a username and a password of at least {MIN_PASSWORD_LENGTH} characters to
                  create the account.
                </Text>
              ) : null}
            </View>
          </Section>
        </View>
      </View>
    </Page>
  );
}
