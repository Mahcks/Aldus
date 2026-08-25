import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import type { DemoPairing, User } from '../../generated/api';
import { KeyboardAvoidingView, Platform, Share, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { BookCover } from '../../features/bookshelf';
import { useAuth } from '../../features/auth/AuthProvider';
import { AuthCard } from '../../features/auth/AuthLayout';
import { useServer } from '../../features/auth/ServerProvider';
import { AppIcon } from '../../features/icons';
import { fadeIn, listItemEnter } from '../../features/motion';
import { ScrollView, Text, View } from '../../features/tw';
import { Button, Field, Notice, colors } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

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
    lift: 'mt-9',
  },
  {
    title: 'Wuthering Heights',
    author: 'Emily Brontë',
    style: 'framed',
    tone: 0,
    layout: 'top',
    lift: 'mt-0',
  },
  {
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    style: 'minimal',
    tone: 4,
    layout: 'bottom',
    lift: 'mt-14',
  },
  {
    title: 'Moby-Dick',
    author: 'Herman Melville',
    style: 'classic',
    tone: 3,
    layout: 'center',
    lift: 'mt-4',
  },
] as const;

function Shelf({ compact }: { compact: boolean }) {
  const covers = shelf.map((book, index) => (
    <Animated.View
      key={book.title}
      entering={listItemEnter(index)}
      className={compact ? '' : book.lift}
    >
      <BookCover
        title={book.title}
        author={book.author}
        size="small"
        generatedCoverStyle={book.style}
        generatedCoverTone={book.tone}
        generatedCoverLayout={book.layout}
      />
    </Animated.View>
  ));

  if (compact) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row items-start gap-3 px-4"
      >
        {covers}
      </ScrollView>
    );
  }

  return <View className="flex-row items-start gap-4">{covers}</View>;
}

export default function DemoWelcome() {
  const auth = useAuth();
  const server = useServer();
  const wide = useWindowDimensions().width >= 1180;
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View className="flex-1 bg-canvas">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName={
            wide
              ? 'min-h-full flex-grow items-center justify-center px-10 py-16'
              : 'flex-grow gap-5 py-6'
          }
        >
          <View
            className={wide ? 'w-full max-w-[1180px] flex-row items-center gap-20' : 'w-full gap-5'}
          >
            <View className={wide ? 'min-w-0 flex-1 gap-10' : 'w-full gap-4'}>
              <Animated.View
                entering={fadeIn}
                className={wide ? 'gap-3' : 'w-full items-center gap-2 px-4'}
              >
                <Text
                  className={`${wide ? 'text-[56px] leading-[58px]' : 'w-full text-center text-4xl leading-10'} font-black tracking-[-1.5px] text-accent`}
                >
                  Aldus
                </Text>
                <Text
                  className={`${wide ? 'max-w-[440px] text-xl leading-8' : 'w-full text-center text-lg leading-7'} text-muted`}
                >
                  A real Aldus library, ready to explore.
                </Text>
              </Animated.View>
              <Shelf compact={!wide} />
            </View>

            <View
              className={
                wide ? 'w-full max-w-[420px]' : 'w-full max-w-[420px] items-center self-center px-4'
              }
            >
              <AuthCard>
                {access ? (
                  <>
                    <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
                      Your demo is ready
                    </Text>
                    <Text className="leading-6 text-muted">
                      Continue here, or use this one-time code in the iPhone app to keep reading and
                      listening progress in sync.
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
                      Your progress and collections are private to this visit and expire after 24
                      hours.
                    </Notice>
                    <Button
                      label={busy ? 'Preparing your library…' : 'Explore demo'}
                      icon="read"
                      kind="primary"
                      disabled={busy}
                      onPress={() => void explore()}
                    />
                    {Platform.OS !== 'web' && showPairing ? (
                      <View className="gap-3 border-t border-line pt-4">
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
                      </View>
                    ) : Platform.OS !== 'web' ? (
                      <Button
                        label="Use pairing code"
                        kind="secondary"
                        onPress={() => setShowPairing(true)}
                      />
                    ) : null}
                    <Button
                      label="Sign in"
                      kind="secondary"
                      onPress={() => router.push('/login')}
                    />
                    {Platform.OS !== 'web' ? (
                      <Button
                        label="Choose another server"
                        kind="quiet"
                        onPress={() => router.push('/connect')}
                      />
                    ) : null}
                  </>
                )}
              </AuthCard>
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
