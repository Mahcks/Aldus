import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { AuthCard, AuthLayout } from '../../features/auth/AuthLayout';
import { Button, Field, Notice } from '../../features/ui';
import { Text } from '../../features/tw';
import { api, errorMessage } from '../../lib/api';

export default function Login() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visibleError = error || auth.error;

  if (auth.user) return <Redirect href="/home" />;
  if (auth.setupAvailable) return <Redirect href="/setup" />;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const user = await api.login({ username, password });
      await auth.signedIn(user);
      router.replace('/home');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Your books and audiobooks, in one place.">
      <AuthCard>
        <Text accessibilityRole="header" className="mb-1 text-2xl font-sans-bold text-ink">
          Sign in
        </Text>
        {visibleError ? <Notice danger>{visibleError}</Notice> : null}
        {auth.error && !error ? (
          <Button label="Retry connection" kind="secondary" onPress={auth.refresh} />
        ) : null}
        <Field
          label="Username"
          autoCapitalize="none"
          autoComplete="username"
          value={username}
          onChangeText={setUsername}
        />
        <Field
          label="Password"
          secureTextEntry
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        <Button
          label={busy ? 'Signing in…' : 'Sign in'}
          kind="primary"
          disabled={busy || !username || !password}
          onPress={submit}
        />
        {auth.demoAvailable ? (
          <Button label="Back to demo" kind="quiet" onPress={() => router.replace('/demo')} />
        ) : null}
        {Platform.OS !== 'web' ? (
          <Button
            label="Use another server"
            kind="quiet"
            onPress={() => router.replace('/connect')}
          />
        ) : null}
      </AuthCard>
    </AuthLayout>
  );
}
