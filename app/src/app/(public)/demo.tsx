import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import type { DemoCredentials, User } from '../../generated/api';
import { KeyboardAvoidingView, Platform, Share, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { BookCover } from '../../features/bookshelf';
import { useAuth } from '../../features/auth/AuthProvider';
import { AuthCard } from '../../features/auth/AuthLayout';
import { useServer } from '../../features/auth/ServerProvider';
import { AppIcon } from '../../features/icons';
import { fadeIn, listItemEnter } from '../../features/motion';
import { ScrollView, Text, View } from '../../features/tw';
import { Button, Notice, colors } from '../../features/ui';
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
    lift: 'mt-6',
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
    lift: 'mt-10',
  },
  {
    title: 'Moby-Dick',
    author: 'Herman Melville',
    style: 'classic',
    tone: 3,
    layout: 'center',
    lift: 'mt-2',
  },
  {
    title: 'Dracula',
    author: 'Bram Stoker',
    style: 'framed',
    tone: 1,
    layout: 'top',
    lift: 'mt-7',
  },
] as const;

function Shelf({ compact }: { compact: boolean }) {
  const covers = shelf.map((book, index) => (
    <Animated.View key={book.title} entering={listItemEnter(index)} className={book.lift}>
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

  return <View className="-ml-3 flex-row gap-3">{covers}</View>;
}

export default function DemoWelcome() {
  const auth = useAuth();
  const server = useServer();
  const wide = useWindowDimensions().width >= 960;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<{
    user: User;
    credentials: DemoCredentials;
  }>();
  const [shared, setShared] = useState(false);

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
    const message = `Aldus demo\nServer: ${server.origin}\nUsername: ${access.credentials.username}\nPassword: ${access.credentials.password}`;
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View className="flex-1 bg-canvas">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName={
            wide ? 'min-h-full flex-grow flex-row items-stretch' : 'flex-grow gap-8 py-8'
          }
        >
          <View
            className={
              wide
                ? 'min-w-0 flex-1 justify-center gap-10 overflow-hidden border-r border-line bg-panel px-16 py-16'
                : 'w-full gap-6'
            }
          >
            <Animated.View entering={fadeIn} className={wide ? 'gap-3' : 'items-center gap-2 px-4'}>
              <Text
                className={`${wide ? 'text-[56px] leading-[58px]' : 'text-4xl leading-10'} font-black tracking-[-1.5px] text-accent`}
              >
                Aldus
              </Text>
              <Text
                className={`${wide ? 'max-w-[440px] text-xl leading-8' : 'text-center text-lg leading-7'} text-muted`}
              >
                A real Aldus library, ready to explore.
              </Text>
            </Animated.View>
            <Shelf compact={!wide} />
          </View>

          <View
            className={
              wide
                ? 'w-full max-w-[440px] items-center justify-center px-10 py-16'
                : 'w-full max-w-[420px] items-center self-center px-4'
            }
          >
            <AuthCard>
              {access ? (
                <>
                  <Text accessibilityRole="header" className="text-2xl font-sans-bold text-ink">
                    Your demo is ready
                  </Text>
                  <Text className="leading-6 text-muted">
                    Use this same account on another device to see reading and listening progress
                    stay in sync.
                  </Text>
                  <View className="gap-4 border-y border-line py-4">
                    <View className="gap-1">
                      <Text className="text-xs font-sans-bold uppercase tracking-wide text-muted">
                        Server
                      </Text>
                      <Text selectable className="font-mono text-sm text-ink">
                        {server.origin}
                      </Text>
                    </View>
                    <View className="gap-1">
                      <Text className="text-xs font-sans-bold uppercase tracking-wide text-muted">
                        Username
                      </Text>
                      <Text selectable className="font-mono text-sm text-ink">
                        {access.credentials.username}
                      </Text>
                    </View>
                    <View className="gap-1">
                      <Text className="text-xs font-sans-bold uppercase tracking-wide text-muted">
                        Password
                      </Text>
                      <Text selectable className="font-mono text-sm text-ink">
                        {access.credentials.password}
                      </Text>
                    </View>
                  </View>
                  {error ? <Notice danger>{error}</Notice> : null}
                  <Notice>These details are shown once and expire with this demo visit.</Notice>
                  <Button
                    label={
                      Platform.OS === 'web' && shared
                        ? 'Copied'
                        : Platform.OS === 'web'
                          ? 'Copy sign-in'
                          : 'Share sign-in'
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
                  <Button label="Sign in" kind="secondary" onPress={() => router.push('/login')} />
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
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
