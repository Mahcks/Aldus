import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { rememberedAccounts, rememberAccount, forgetAccount } from '@/lib/remembered-accounts';
import { Platform } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { useServer } from '@/features/auth/ServerProvider';
import { Button, Checkbox, Field, Notice } from '@/features/ui';
import { Text, View } from '@/features/tw';
import { api, errorMessage } from '@/lib/api';

export default function Login() {
  const auth = useAuth();
  const server = useServer();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visibleError = error || auth.error;
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof rememberedAccounts>>>([]);
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    let active = true;
    void rememberedAccounts()
      .then((values) => {
        if (active) setAccounts(values);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [server.origin]);

  if (auth.user) return <Redirect href="/home" />;
  if (auth.setupAvailable) return <Redirect href="/setup" />;

  async function submit() {
    if (busy || !username || !password) return;
    setBusy(true);
    setError('');
    try {
      const user = await api.login({ username, password });
      if (remember && !user.demo_expires_at) await rememberAccount(user).catch(() => {});
      await auth.signedIn(user);
      router.replace(user.must_change_credentials ? '/claim' : '/home');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function forgetReader(id: string) {
    try {
      await forgetAccount(id);
      setAccounts(await rememberedAccounts());
    } catch (value) {
      setError(errorMessage(value));
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
      {accounts.length ? (
        <View className="gap-2">
          <Text className="text-base font-sans-bold text-ink">Who’s reading?</Text>
          {accounts.map((account) => (
            <View key={account.id} className="flex-row items-center gap-2">
              <View className="flex-1">
                <Button
                  label={account.display_name || account.username}
                  selected={username === account.username}
                  disabled={busy}
                  onPress={() => {
                    setUsername(account.username);
                    setPassword('');
                    setRemember(true);
                    setError('');
                  }}
                />
              </View>
              <Button
                label="Forget"
                kind="quiet"
                disabled={busy}
                onPress={() => void forgetReader(account.id)}
              />
            </View>
          ))}
          <Text className="text-sm text-muted">
            Choose a name, then enter that person’s password. Forget removes the shortcut, not their
            books.
          </Text>
        </View>
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
      <Checkbox
        label="Remember my name on this device"
        checked={remember}
        disabled={busy}
        onPress={() => setRemember((value) => !value)}
      />
      <Button
        label={busy ? 'Signing in…' : 'Sign in'}
        kind="primary"
        disabled={busy || !username || !password}
        onPress={submit}
      />
      <Text className="text-sm leading-5 text-muted">
        Forgot your password? Ask the person who manages this library to reset it.
      </Text>
    </AuthLayout>
  );
}
