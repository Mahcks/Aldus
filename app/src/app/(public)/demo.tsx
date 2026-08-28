import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import type { DemoPairing, User } from '@/generated/api';
import { Platform, Share } from 'react-native';
import Animated from 'react-native-reanimated';
import { BookCover } from '@/features/bookshelf';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { useServer } from '@/features/auth/ServerProvider';
import { AppIcon } from '@/features/icons';
import { listItemEnter } from '@/features/motion';
import { ScrollView, Text, View } from '@/features/tw';
import { Button, Field, Notice, colors } from '@/features/ui';
import { api, errorMessage } from '@/lib/api';

const features = [
  ['read', 'Read complete public-domain ebooks'],
  ['listen', 'Listen with chapters and saved position'],
  ['synced', 'Try synchronized reading and listening'],
] as const;

/**
 * A fixed, varied set of Aldus's own generated covers — not real artwork.
 * The point of the shelf is to sell the product's own look (this is what
 * an Aldus edition looks like), which is guaranteed to render identically
 * everywhere the demo is deployed, unlike fetching real cover art.
 */
const shelf = [
  {
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    style: 'classic',
    tone: 2,
    layout: 'center',
  },
  { title: 'Wuthering Heights', author: 'Emily Brontë', style: 'framed', tone: 0, layout: 'top' },
  { title: 'Jane Eyre', author: 'Charlotte Brontë', style: 'minimal', tone: 4, layout: 'bottom' },
  { title: 'Moby-Dick', author: 'Herman Melville', style: 'classic', tone: 3, layout: 'center' },
] as const;

/**
 * Always a horizontal scroller, at every viewport width — a second,
 * non-scrolling grid variant used to exist for wide screens, but a
 * component having two different shapes depending on breakpoint is exactly
 * the kind of inconsistency that made this flow feel like separate apps
 * stitched together. One shape, everywhere.
 */
function Shelf() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row items-start gap-3"
    >
      {shelf.map((book, index) => (
        <Animated.View key={book.title} entering={listItemEnter(index)}>
          <BookCover
            title={book.title}
            author={book.author}
            size="small"
            generatedCoverStyle={book.style}
            generatedCoverTone={book.tone}
            generatedCoverLayout={book.layout}
          />
        </Animated.View>
      ))}
    </ScrollView>
  );
}

export default function DemoWelcome() {
  const auth = useAuth();
  const server = useServer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<{
    user: User;
    pairing: DemoPairing;
  }>();
  const [shared, setShared] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [pairingCode, setPairingCode] = useState('');

  if (auth.user && !access) return <Redirect href="/home" />;
  if (!server.connected) return <Redirect href="/connect" />;
  if (!auth.loading && !auth.demoAvailable) return <Redirect href="/login" />;

  async function explore() {
    setBusy(true);
    setError('');
    try {
      setAccess(await api.demoLogin());
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function continueDemo() {
    if (!access) return;
    await auth.signedIn(access.user);
    router.replace('/home');
  }

  async function shareSignIn() {
    if (!access) return;
    const message = `Aldus demo\nServer: ${server.origin}\nPairing code: ${access.pairing.code}`;
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(message);
        setShared(true);
      } else {
        await Share.share({ message });
      }
    } catch {
      setError('Could not share the sign-in details. You can still select and copy them below.');
    }
  }

  async function pairDemo() {
    setBusy(true);
    setError('');
    try {
      const user = await api.pairDemo(pairingCode);
      await auth.signedIn(user);
      router.replace('/home');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout wide>
      <Shelf />
      <Text className="text-base leading-6 text-muted">
        A real Aldus library, ready to explore.
      </Text>
      {access ? (
        <>
          <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
            Your demo is ready
          </Text>
          <Text className="leading-6 text-muted">
            Continue here, or use this one-time code in the iPhone app to keep reading and listening
            progress in sync.
          </Text>
          <View className="gap-3 border-y border-line py-4">
            <View className="gap-1">
              <Text className="text-xs font-sans-bold uppercase tracking-wide text-muted">
                Server
              </Text>
              <Text selectable className="font-mono text-sm text-ink">
                {server.origin}
              </Text>
            </View>
            <View className="gap-2">
              <Text className="text-xs font-sans-bold uppercase tracking-wide text-muted">
                Pairing code
              </Text>
              <Text selectable className="font-mono text-3xl tracking-[4px] text-ink">
                {access.pairing.code}
              </Text>
            </View>
          </View>
          {error ? <Notice danger>{error}</Notice> : null}
          <Notice>This code expires in 10 minutes and works once.</Notice>
          <Button
            label={
              Platform.OS === 'web' && shared
                ? 'Copied'
                : Platform.OS === 'web'
                  ? 'Copy code'
                  : 'Share code'
            }
            icon="copy"
            kind="secondary"
            onPress={() => void shareSignIn()}
          />
          <Button
            label="Continue exploring"
            icon="read"
            kind="primary"
            onPress={() => void continueDemo()}
          />
        </>
      ) : (
        <>
          <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
            Welcome to the Aldus demo
          </Text>
          <Text className="leading-6 text-muted">
            Browse, read, and listen without setting up a server of your own.
          </Text>
          <View className="gap-2">
            {features.map(([icon, label]) => (
              <View key={label} className="flex-row items-center gap-2.5">
                <AppIcon name={icon} size={16} color={colors.accent} />
                <Text className="flex-1 text-sm leading-5 text-ink">{label}</Text>
              </View>
            ))}
          </View>
          {error || auth.error ? <Notice danger>{error || auth.error}</Notice> : null}
          {auth.error && !error ? (
            <Button label="Retry connection" kind="secondary" onPress={auth.refresh} />
          ) : null}
          <Button
            label={busy ? 'Preparing your library…' : 'Explore demo'}
            icon="read"
            kind="primary"
            disabled={busy}
            onPress={() => void explore()}
          />
          <Text className="text-center text-xs leading-4 text-subtle">
            Private to this visit, expires in 24 hours.
          </Text>
          {Platform.OS !== 'web' && showPairing ? (
            <View className="gap-3 border-t border-line pt-3">
              <Field
                label="Pairing code"
                help="Enter the code shown on the demo website."
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={9}
                value={pairingCode}
                onChangeText={(value) => setPairingCode(value.toUpperCase())}
                onSubmitEditing={() => void pairDemo()}
              />
              <Button
                label={busy ? 'Connecting…' : 'Continue this demo'}
                kind="secondary"
                disabled={busy || pairingCode.replace(/-/g, '').length !== 8}
                onPress={() => void pairDemo()}
              />
              <Button
                label="Cancel"
                kind="quiet"
                disabled={busy}
                onPress={() => setShowPairing(false)}
              />
            </View>
          ) : Platform.OS !== 'web' ? (
            <View className="gap-1 border-t border-line pt-3">
              <Button
                label="Connect to my library"
                icon="system"
                kind="secondary"
                onPress={() => router.push('/connect')}
              />
              <Button
                label="Continue on another device"
                kind="quiet"
                onPress={() => setShowPairing(true)}
              />
            </View>
          ) : null}
        </>
      )}
    </AuthLayout>
  );
}
