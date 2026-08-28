import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { useAuth } from '@/features/auth/AuthProvider';
import { Text } from '@/features/tw';
import { Button, Field, Notice } from '@/features/ui';
import { api, errorMessage } from '@/lib/api';

export default function ClaimAccount() {
  const auth = useAuth();
  const [form, setForm] = useState({
    username: auth.user?.username || '',
    display_name: auth.user?.display_name || '',
    password: '',
    password_confirmation: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!auth.user) return <Redirect href="/login" />;
  if (!auth.user.must_change_credentials) return <Redirect href="/home" />;

  const passwordsMatch = form.password === form.password_confirmation;
  const canSubmit =
    form.username.trim().length >= 3 && form.password.length >= 12 && passwordsMatch && !busy;
  const change = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const user = await api.claimAccount(form);
      await auth.signedIn(user);
      router.replace('/home');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
        Make this account yours
      </Text>
      <Text className="leading-[21px] text-muted">
        The server owner gave you a one-time password. Choose the name and password you will use
        from now on.
      </Text>
      {error ? <Notice danger>{error}</Notice> : null}
      <Field
        label="Username"
        autoCapitalize="none"
        autoComplete="username-new"
        value={form.username}
        onChangeText={change('username')}
        help="At least 3 characters. Your e-reader will use this username too."
      />
      <Field label="Display name" value={form.display_name} onChangeText={change('display_name')} />
      <Field
        label="New password"
        secureTextEntry
        autoComplete="new-password"
        value={form.password}
        onChangeText={change('password')}
        help="Use at least 12 characters."
      />
      <Field
        label="Confirm new password"
        secureTextEntry
        autoComplete="new-password"
        value={form.password_confirmation}
        onChangeText={change('password_confirmation')}
        onSubmitEditing={submit}
        error={
          form.password_confirmation && !passwordsMatch ? 'Passwords do not match.' : undefined
        }
      />
      <Button
        label="Finish account setup"
        kind="primary"
        loading={busy}
        disabled={!canSubmit}
        onPress={submit}
      />
      <Button label="Sign out" kind="quiet" onPress={() => void auth.signOut()} />
    </AuthLayout>
  );
}
