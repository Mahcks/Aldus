import type { User } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section, shared } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

export default function UsersScreen() {
  const auth = useAuth(); const [users, setUsers] = useState<User[]>([]); const [form, setForm] = useState({ username: '', display_name: '', password: '', admin: false }); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  async function load() { try { setUsers(await api.users()); } catch (value) { setError(errorMessage(value)); } finally { setLoading(false); } }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (auth.user?.admin) void load(); }, [auth.user?.admin]);
  if (!auth.user?.admin) return <Page title="Users" back={<Button label="Libraries" kind="quiet" onPress={() => router.replace('/libraries')} />}><Notice>This page is available to global administrators.</Notice></Page>;
  const change = (key: 'username' | 'display_name' | 'password') => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function create() { try { await api.createUser(form); setForm({ username: '', display_name: '', password: '', admin: false }); await load(); } catch (value) { setError(errorMessage(value)); } }
  return <Page title="Users" back={<Button label="Libraries" kind="quiet" onPress={() => router.replace('/libraries')} />}>{error ? <Notice danger>{error}</Notice> : null}<View style={shared.split}><View style={shared.grow}><Section title="Accounts">{loading ? <Loading /> : users.length === 0 ? <Empty>No accounts.</Empty> : users.map((user) => <View key={user.id} style={shared.listItem}><Text style={shared.itemTitle}>{user.display_name || user.username}</Text><Text style={shared.itemMeta}>{user.username} · {user.admin ? 'administrator' : 'user'} · {user.disabled ? 'disabled' : 'enabled'}</Text><Text selectable style={shared.mono}>{user.id}</Text><Button label={user.disabled ? 'Enable' : 'Disable'} kind={user.disabled ? 'secondary' : 'danger'} onPress={async () => { try { await api.updateUser(user.id, { disabled: !user.disabled }); await load(); } catch (value) { setError(errorMessage(value)); } }} /></View>)}</Section></View><View style={shared.grow}><Section title="Create account"><View style={shared.form}><Field label="Username" autoCapitalize="none" value={form.username} onChangeText={change('username')} /><Field label="Display name" value={form.display_name} onChangeText={change('display_name')} /><Field label="Password (12 characters minimum)" secureTextEntry value={form.password} onChangeText={change('password')} /><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: form.admin }} onPress={() => setForm((current) => ({ ...current, admin: !current.admin }))}><Row><Text>{form.admin ? '☑' : '☐'}</Text><Text>Create as global administrator</Text></Row></Pressable><Button label="Create account" kind="primary" disabled={!form.username || form.password.length < 12} onPress={create} /></View></Section></View></View></Page>;
}
