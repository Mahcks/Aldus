import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { AuthCard, AuthLayout } from '../../features/auth/AuthLayout';
import { useAuth } from '../../features/auth/AuthProvider';
import { useServer } from '../../features/auth/ServerProvider';
import { AppIcon } from '../../features/icons';
import { Text, View } from '../../features/tw';
import { Button, Notice, colors } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

const features = [
  ['read', 'Read complete public-domain ebooks'],
  ['listen', 'Listen with chapters and saved position'],
  ['synced', 'Try synchronized reading and listening'],
] as const;

export default function DemoWelcome() {
  const auth = useAuth();
  const server = useServer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (auth.user) return <Redirect href="/home" />;
  if (!server.connected) return <Redirect href="/connect" />;
  if (!auth.loading && !auth.demoAvailable) return <Redirect href="/login" />;

  async function explore() {
    setBusy(true);
    setError('');
    try {
      const user = await api.demoLogin();
      await auth.signedIn(user);
      router.replace('/home');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="A real Aldus library, ready to explore.">
      <AuthCard>
        <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
          Welcome to the Aldus demo
        </Text>
        <Text className="leading-6 text-muted">
          Browse, read, and listen without setting up a server of your own.
        </Text>
        <View className="gap-3 border-y border-line py-4">
          {features.map(([icon, label]) => (
            <View key={label} className="flex-row items-center gap-3">
              <AppIcon name={icon} size={20} color={colors.accent} />
              <Text className="flex-1 leading-6 text-ink">{label}</Text>
            </View>
          ))}
        </View>
        {error || auth.error ? <Notice danger>{error || auth.error}</Notice> : null}
        {auth.error && !error ? (
          <Button label="Retry connection" kind="secondary" onPress={auth.refresh} />
        ) : null}
        <Notice>
          Your progress and collections are private to this visit and expire after 24 hours.
        </Notice>
        <Button
          label={busy ? 'Preparing your library…' : 'Explore demo'}
          icon="read"
          kind="primary"
          disabled={busy}
          onPress={() => void explore()}
        />
        <Button label="Sign in" kind="secondary" onPress={() => router.push('/login')} />
        {Platform.OS !== 'web' ? (
          <Button
            label="Choose another server"
            kind="quiet"
            onPress={() => router.push('/connect')}
          />
        ) : null}
      </AuthCard>
    </AuthLayout>
  );
}
