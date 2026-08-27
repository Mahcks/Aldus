import { Redirect, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { AuthLayout } from '../../features/auth/AuthLayout';
import { useServer } from '../../features/auth/ServerProvider';
import { Text, View } from '../../features/tw';
import { Button, ConfirmDialog, Field, IconRow, Notice } from '../../features/ui';
import type { ServerProfile } from '../../lib/server-profiles';

function LibraryProfileRow({
  profile,
  current,
  onConnect,
  onForget,
}: {
  profile: ServerProfile;
  current: boolean;
  onConnect: () => void;
  onForget: () => void;
}) {
  const title = profile.origin.replace(/^https?:\/\//, '');
  const swipeable = useRef<SwipeableMethods>(null);
  const suppressPress = useRef(false);

  function handlePress() {
    if (suppressPress.current) {
      swipeable.current?.close();
      return;
    }
    onConnect();
  }

  const row = (
    <IconRow
      icon="system"
      title={title}
      subtitle={current ? 'Current library' : 'Previously used'}
      onPress={handlePress}
    />
  );

  if (current) return row;

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableOpenStartDrag={() => {
        suppressPress.current = true;
      }}
      onSwipeableCloseStartDrag={() => {
        suppressPress.current = true;
      }}
      onSwipeableOpen={() => {
        suppressPress.current = true;
      }}
      onSwipeableClose={() => {
        suppressPress.current = false;
      }}
      renderRightActions={(_progress, _translation, swipeable) => (
        <View className="ml-2 w-24 justify-center">
          <Button
            label="Forget"
            accessibilityLabel={`Forget ${title}`}
            icon="delete"
            kind="danger"
            onPress={() => {
              swipeable.close();
              onForget();
            }}
          />
        </View>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

export default function Connect() {
  const server = useServer();
  const canGoBack = router.canGoBack();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetting, setForgetting] = useState<ServerProfile>();
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

  async function forget() {
    if (!forgetting) return;
    setForgetBusy(true);
    setError('');
    try {
      await server.forget(forgetting.origin);
      setForgetting(undefined);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Unable to forget this library.');
    } finally {
      setForgetBusy(false);
    }
  }

  return (
    <>
      <AuthLayout backLabel="Back" onBack={canGoBack ? () => router.back() : undefined}>
        <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
          Connect to your library
        </Text>
        <Text className="leading-6 text-muted">
          Enter the address provided by your library owner.
        </Text>
        {error ? <Notice danger>{error}</Notice> : null}
        <Field
          label="Library address"
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
            <Text className="text-sm font-sans-semibold text-ink">Your libraries</Text>
            {server.profiles.some((profile) => profile.origin !== server.origin) ? (
              <Text className="text-sm text-muted">Swipe a previous library to forget it.</Text>
            ) : null}
            {server.profiles.map((profile) => (
              <LibraryProfileRow
                key={profile.origin}
                profile={profile}
                current={profile.origin === server.origin}
                onConnect={() => void connect(profile.origin)}
                onForget={() => setForgetting(profile)}
              />
            ))}
          </View>
        ) : null}
      </AuthLayout>
      <ConfirmDialog
        visible={Boolean(forgetting)}
        title="Forget this library?"
        description={`Aldus will remove the saved sign-in and downloaded books for ${forgetting?.origin.replace(/^https?:\/\//, '') || 'this library'} from this device. Nothing will be deleted from the server.`}
        confirmLabel="Forget library"
        danger
        busy={forgetBusy}
        onClose={() => setForgetting(undefined)}
        onConfirm={() => void forget()}
      />
    </>
  );
}
