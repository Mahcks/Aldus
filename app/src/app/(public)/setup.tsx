import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import { AuthCard, AuthLayout } from '../../features/auth/AuthLayout';
import { Button, Field, Notice } from '../../features/ui';
import { Text } from '../../features/tw';
import { APIError, api, errorMessage } from '../../lib/api';

export default function Setup() {
  const auth = useAuth();
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    password: '',
    password_confirmation: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (auth.user) return <Redirect href="/libraries" />;
  if (!auth.loading && !auth.setupAvailable) return <Redirect href="/login" />;

  const change = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const user = await api.setup(form);
      setForm((value) => ({ ...value, password: '', password_confirmation: '' }));
      auth.signedIn(user);
      router.replace('/system');
    } catch (value) {
      setError(
        value instanceof APIError && value.status === 404
          ? 'Aldus is already set up.'
          : errorMessage(value),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthCard>
        <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
          Create the first administrator
        </Text>
        <Text className="mb-1 leading-[21px] text-muted">
          This one-time setup closes permanently after the account is created. The first account has
          administrator access.
        </Text>
        {error ? <Notice danger>{error}</Notice> : null}
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
        <Field
          label="Confirm password"
          secureTextEntry
          value={form.password_confirmation}
          onChangeText={change('password_confirmation')}
          error={
            form.password_confirmation && form.password_confirmation !== form.password
              ? 'Passwords do not match.'
              : undefined
          }
        />
        <Button
          label={busy ? 'Creating administrator…' : 'Create administrator'}
          kind="primary"
          disabled={
            busy ||
            !form.username ||
            form.password.length < 12 ||
            form.password !== form.password_confirmation
          }
          onPress={submit}
        />
      </AuthCard>
    </AuthLayout>
  );
}
