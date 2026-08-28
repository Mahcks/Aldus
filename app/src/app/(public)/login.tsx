import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { useServer } from '@/features/auth/ServerProvider';
import { Button, Field, Notice } from '@/features/ui';
import { Text } from '@/features/tw';
import { api, errorMessage } from '@/lib/api';

export default function Login() {
  const auth = useAuth();
  const server = useServer();
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
      router.replace(user.must_change_credentials ? '/claim' : '/home');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      backLabel={Platform.OS !== 'web' ? 'Libraries' : undefined}
      onBack={Platform.OS !== 'web' ? () => router.push('/connect') : undefined}
    >
      <Text accessibilityRole="header" className="mb-1 text-2xl font-sans-bold text-ink">
        Sign in to your library
      </Text>
      <Text numberOfLines={1} selectable className="border-b border-line pb-4 text-sm text-muted">
        {server.origin.replace(/^https?:\/\//, '')}
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
      <Text className="text-sm leading-5 text-muted">
        Forgot your password? Ask the person who runs this library to reset it. Aldus does not send
        password-reset email.
      </Text>
    </AuthLayout>
  );
}
