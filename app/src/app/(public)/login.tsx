import { Redirect, router } from 'expo-router';
import { useState } from 'react';
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

  if (auth.user) return <Redirect href="/libraries" />;
  if (auth.setupAvailable) return <Redirect href="/setup" />;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const user = await api.login({ username, password });
      auth.signedIn(user);
      router.replace('/libraries');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Your books and audiobooks, in one place.">
      <AuthCard>
        <Text accessibilityRole="header" className="mb-1 text-2xl font-extrabold text-ink">
          Sign in
        </Text>
        {error ? <Notice danger>{error}</Notice> : null}
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
      </AuthCard>
    </AuthLayout>
  );
}
