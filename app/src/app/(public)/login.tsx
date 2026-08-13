import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { Button, Field, Notice, colors } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

export default function Login() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (auth.user) return <Redirect href="/libraries" />;
  if (auth.setupAvailable) return <Redirect href="/setup" />;
  async function submit() {
    setBusy(true); setError('');
    try { const user = await api.login({ username, password }); auth.signedIn(user); router.replace('/libraries'); }
    catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}><View style={styles.brand}><Text style={styles.wordmark}>Aldus</Text><Text style={styles.tagline}>Your books and audiobooks, in one place.</Text></View><View style={styles.form}><Text accessibilityRole="header" style={styles.title}>Sign in</Text>{error ? <Notice danger>{error}</Notice> : null}<Field label="Username" autoCapitalize="none" autoComplete="username" value={username} onChangeText={setUsername} /><Field label="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} onSubmitEditing={submit} /><Button label={busy ? 'Signing in…' : 'Sign in'} kind="primary" disabled={busy || !username || !password} onPress={submit} /></View></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.canvas, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 56 }, brand: { maxWidth: 360, gap: 8 }, wordmark: { color: colors.accent, fontSize: 44, fontWeight: '900', letterSpacing: -1.5 }, tagline: { color: colors.muted, fontSize: 18, lineHeight: 27 }, form: { width: '100%', maxWidth: 390, padding: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 8, gap: 14 }, title: { color: colors.ink, fontSize: 24, fontWeight: '800', marginBottom: 4 } });
