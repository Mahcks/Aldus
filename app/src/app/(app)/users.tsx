import type { User } from '../../generated/api';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  Button,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  shared,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';
import { goBackOr } from '../../lib/navigation';

const emptyForm = { username: '', display_name: '', password: '', admin: false };

export default function UsersScreen() {
  const auth = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  if (!auth.user?.admin)
    return (
      <Page
        title="Users"
        back={<Button label="Libraries" kind="quiet" onPress={() => goBackOr('/libraries')} />}
      >
        <Notice>This page is available to global administrators.</Notice>
      </Page>
    );
  const change = (key: 'username' | 'display_name' | 'password') => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
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
  return (
    <Page
      title="Users"
      back={<Button label="Libraries" kind="quiet" onPress={() => goBackOr('/libraries')} />}
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <View style={shared.split}>
        <View style={shared.grow}>
          <Section title="Accounts">
            {loading ? (
              <Loading />
            ) : users.length === 0 ? (
              <Empty>No accounts.</Empty>
            ) : (
              users.map((user) => (
                <View key={user.id} style={shared.listItem}>
                  <Text style={shared.itemTitle}>{user.display_name || user.username}</Text>
                  <Text style={shared.itemMeta}>
                    {user.username} · {user.admin ? 'administrator' : 'user'} ·{' '}
                    {user.disabled ? 'disabled' : 'enabled'}
                  </Text>
                  <Text selectable style={shared.mono}>
                    {user.id}
                  </Text>
                  <Button
                    label={user.disabled ? 'Enable' : 'Disable'}
                    kind={user.disabled ? 'secondary' : 'danger'}
                    onPress={() => void toggleUser(user)}
                  />
                </View>
              ))
            )}
          </Section>
        </View>
        <View style={shared.grow}>
          <Section title="Create account">
            <View style={shared.form}>
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
                label="Password (12 characters minimum)"
                secureTextEntry
                value={form.password}
                onChangeText={change('password')}
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: form.admin }}
                onPress={() => setForm((current) => ({ ...current, admin: !current.admin }))}
              >
                <Row>
                  <Text>{form.admin ? '☑' : '☐'}</Text>
                  <Text>Create as global administrator</Text>
                </Row>
              </Pressable>
              <Button
                label="Create account"
                kind="primary"
                disabled={!form.username || form.password.length < 12}
                onPress={createUser}
              />
            </View>
          </Section>
        </View>
      </View>
    </Page>
  );
}
