import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { AuthCard, AuthLayout } from '../../features/auth/AuthLayout';
import { useServer } from '../../features/auth/ServerProvider';
import { Text, View } from '../../features/tw';
import { Button, Field, Notice } from '../../features/ui';

export default function Connect() {
  const server = useServer();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (Platform.OS === 'web') return <Redirect href="/" />;

  async function connect(nextAddress = address) {
    setBusy(true);
    setError('');
    try {
      const status = await server.connect(nextAddress);
      router.replace(status.demo_available ? '/demo' : status.available ? '/setup' : '/login');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Unable to connect to Aldus.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Your library can live anywhere. Aldus keeps each server separate on this device.">
      <AuthCard>
        <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
          Connect to Aldus
        </Text>
        <Text className="leading-6 text-muted">Enter the address your server owner gave you.</Text>
        {error ? <Notice danger>{error}</Notice> : null}
        <Field
          label="Server address"
          help="For example, demo.aldus.media or http://192.168.1.20:8080"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={() => void connect()}
        />
        <Button
          label={busy ? 'Connecting…' : 'Continue'}
          icon="system"
          kind="primary"
          disabled={busy || !address.trim()}
          onPress={() => void connect()}
        />
        {server.profiles.length > 0 ? (
          <View className="mt-2 gap-2 border-t border-line pt-4">
            <Text className="text-sm font-sans-semibold text-ink">Previous servers</Text>
            {server.profiles.map((profile) => (
              <Button
                key={profile.origin}
                label={profile.origin.replace(/^https?:\/\//, '')}
                kind="secondary"
                onPress={() => void connect(profile.origin)}
              />
            ))}
          </View>
        ) : null}
      </AuthCard>
    </AuthLayout>
  );
}
