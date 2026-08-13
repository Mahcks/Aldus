import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { Button, Field, Notice, colors } from '../../features/ui';
import { APIError, api, errorMessage } from '../../lib/api';

export default function Setup() {
  const auth = useAuth();
  const [form, setForm] = useState({ username: '', display_name: '', password: '', bootstrap_token: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (auth.user) return <Redirect href="/libraries" />;
  if (!auth.loading && !auth.setupAvailable) return <Redirect href="/login" />;
  const change = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function submit() {
    setBusy(true); setError('');
    try { const user = await api.bootstrap(form); setForm((value) => ({ ...value, bootstrap_token: '' })); auth.signedIn(user); router.replace('/libraries'); }
    catch (value) { setError(value instanceof APIError && value.status === 503 ? 'Setup is disabled on this server. Configure ALDUS_BOOTSTRAP_TOKEN and restart it.' : errorMessage(value)); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}><View style={styles.form}><Text style={styles.wordmark}>Aldus</Text><Text accessibilityRole="header" style={styles.title}>Create the first administrator</Text><Text style={styles.help}>This one-time setup closes permanently after the account is created.</Text>{error ? <Notice danger>{error}</Notice> : null}<Field label="Username" autoCapitalize="none" value={form.username} onChangeText={change('username')} /><Field label="Display name" value={form.display_name} onChangeText={change('display_name')} /><Field label="Password (12 characters minimum)" secureTextEntry value={form.password} onChangeText={change('password')} /><Field label="Bootstrap token" secureTextEntry value={form.bootstrap_token} onChangeText={change('bootstrap_token')} /><Button label={busy ? 'Creating administrator…' : 'Create administrator'} kind="primary" disabled={busy || !form.username || form.password.length < 12 || !form.bootstrap_token} onPress={submit} /></View></KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', padding: 24 }, form: { width: '100%', maxWidth: 480, gap: 13, padding: 24, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 8 }, wordmark: { color: colors.accent, fontSize: 28, fontWeight: '900' }, title: { color: colors.ink, fontSize: 22, fontWeight: '800' }, help: { color: colors.muted, lineHeight: 21, marginBottom: 5 } });
