import { Platform } from 'react-native';
import type { Collection, Notification, Work, WorkSummary } from '@/generated/api';
import type { Href } from 'expo-router';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type PropsWithChildren } from 'react';
import Animated from 'react-native-reanimated';
import { BookCover, ContinueCard, coverPresentation, WorkCard } from '@/features/bookshelf';
import { requestNotification } from '@/features/activity-presentation';
import { collectionCount } from '@/features/collection-presentation';
import { workProgressLabel } from '@/features/consumption';
import { AppIcon } from '@/features/icons';
import { listItemEnter } from '@/features/motion';
import { notificationHref } from '@/features/notification-presentation';
import { colors } from '@/features/theme';
import { Pressable, ScrollView, Text, View } from '@/features/tw';
import {
  Button,
  EmptyState,
  LoadingState,
  Notice,
  Page,
  resolvePressStateClass,
  Section,
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';
import { offlineWorkSummaries } from '@/lib/offline-library';

function workHref(work: WorkSummary): Href {
  return `/work/${work.id}` as Href;
}

/**
 * Horizontal shelf, like books standing side by side — home's sections
 * browse the same way a real shelf does (scan left to right) rather than
 * the vertical scan of a list, which is reserved here for the two
 * notification-shaped sections (Ready for you, Collections).
 */
function Shelf({ children }: PropsWithChildren) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row items-start gap-4 pr-4"
    >
      {children}
    </ScrollView>
  );
}

function ContinueShelf({ works }: { works: WorkSummary[] }) {
  return (
    <Shelf>
      {works.map((work, index) => {
        const mode = work.last_mode || (work.readable ? 'read' : 'listen');
        return (
          <Animated.View key={work.id} entering={listItemEnter(index)}>
            <ContinueCard
              title={work.title}
              author={work.author}
              coverURL={work.cover_url}
              coverPresentation={coverPresentation(work)}
              availability={work}
              progress={workProgressLabel(work.in_progress, work.completion_percent)}
              continueMode={mode}
              size="hero"
              onOpen={() => router.push(workHref(work))}
              onContinue={() => router.push(`/consume/${work.id}?mode=${mode}`)}
              continueHref={`/consume/${work.id}?mode=${mode}`}
              actions={[
                { label: 'Book details', onPress: () => router.push(workHref(work)) },
                ...(work.readable
                  ? [{ label: 'Read', onPress: () => router.push(`/consume/${work.id}?mode=read`) }]
                  : []),
                ...(work.listenable
                  ? [
                      {
                        label: 'Listen',
                        onPress: () => router.push(`/consume/${work.id}?mode=listen`),
                      },
                    ]
                  : []),
                ...(Platform.OS !== 'web'
                  ? [
                      {
                        label: 'Downloads',
                        onPress: () => router.push(`/work/${work.id}?action=downloads`),
                      },
                    ]
                  : []),
                {
                  label: 'Add to collection',
                  onPress: () => router.push(`/work/${work.id}?action=collection`),
                },
                {
                  label: 'Reading status',
                  onPress: () => router.push(`/work/${work.id}?action=status`),
                },
              ]}
            />
          </Animated.View>
        );
      })}
    </Shelf>
  );
}

function WorkShelf({ works }: { works: WorkSummary[] }) {
  return (
    <Shelf>
      {works.map((work, index) => (
        <Animated.View key={work.id} entering={listItemEnter(index)}>
          <WorkCard
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            coverPresentation={coverPresentation(work)}
            availability={work}
            progress={workProgressLabel(work.in_progress, work.completion_percent)}
            onPress={() => router.push(workHref(work))}
          />
        </Animated.View>
      ))}
    </Shelf>
  );
}

function ReadyRow({ item, work }: { item: Notification; work?: Work }) {
  const href = notificationHref(item.action_url);
  const request = requestNotification(item);
  const title = request?.title ?? item.body ?? item.title;
  const format = request?.format;
  const canConsume = href?.startsWith('/consume/');

  async function open() {
    await api.markNotificationRead(item.id).catch(() => undefined);
    if (href) router.push(href as Href);
  }

  return (
    <View className="flex-row items-center gap-3 border-b border-line py-3">
      <BookCover
        title={title}
        coverURL={work?.cover_url}
        {...(work ? coverPresentation(work) : {})}
        size="mini"
      />
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={1} className="font-editorial-bold text-base text-ink">
          {title}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <AppIcon name="check" size={15} color={colors.success} />
          <Text className="text-xs font-sans-semibold text-success">
            {format === 'audiobook' ? 'Audiobook ready' : 'Ebook ready'}
          </Text>
        </View>
      </View>
      {href ? (
        <Button
          label={canConsume ? (format === 'audiobook' ? 'Listen now' : 'Read now') : 'View request'}
          icon={canConsume ? (format === 'audiobook' ? 'listen' : 'read') : undefined}
          kind="primary"
          onPress={open}
        />
      ) : null}
    </View>
  );
}

function CollectionRow({ item }: { item: Collection }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.title}, ${collectionCount(item.work_count)}`}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => router.push(`/collection/${item.id}`)}
      className={`min-h-14 flex-row items-center gap-3 border-b border-line py-3 ${resolvePressStateClass({ focused, pressed })}`}
    >
      <View className="h-10 w-10 items-center justify-center">
        <AppIcon name="collections" size={20} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-editorial-bold text-base text-ink">
          {item.title}
        </Text>
        <Text className="text-sm text-muted">{collectionCount(item.work_count)}</Text>
      </View>
      <AppIcon name="chevron" size={20} color={colors.subtle} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const [continuing, setContinuing] = useState<WorkSummary[]>([]);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [wantToRead, setWantToRead] = useState<WorkSummary[]>([]);
  const [finished, setFinished] = useState<WorkSummary[]>([]);
  const [ready, setReady] = useState<Notification[]>([]);
  const [readyWorks, setReadyWorks] = useState<Record<string, Work>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let canceled = false;
      async function load() {
        try {
          const [progressPage, recentPage, wantPage, finishedPage, inbox, savedCollections] =
            await Promise.all([
              api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 6 }),
              api.browseWorks({ sort: 'recent', limit: 8 }),
              api.browseWorks({ status: 'want_to_read', sort: 'updated', limit: 6 }),
              api.browseWorks({ status: 'finished', sort: 'updated', limit: 6 }),
              api.notifications().catch(() => ({ items: [], unread_count: 0 })),
              api.collections().catch(() => []),
            ]);
          if (canceled) return;
          setError('');
          setOffline(false);
          setContinuing(progressPage.items);
          setRecent(recentPage.items);
          setWantToRead(wantPage.items);
          setFinished(finishedPage.items);
          const readyItems = inbox.items
            .filter(
              (item) => /ready|available/.test(item.kind) && notificationHref(item.action_url),
            )
            .slice(0, 5);
          setReady(readyItems);
          setCollections(savedCollections.slice(0, 5));

          const workIDs = [
            ...new Set(readyItems.map((item) => item.work_id).filter(Boolean)),
          ] as string[];
          if (workIDs.length) {
            const works = await Promise.all(
              workIDs.map((workID) => api.work(workID).catch(() => undefined)),
            );
            if (canceled) return;
            setReadyWorks(
              Object.fromEntries(
                works
                  .filter((value): value is NonNullable<typeof value> => Boolean(value))
                  .map((value) => [value.id, value]),
              ),
            );
          } else {
            setReadyWorks({});
          }
        } catch (value) {
          if (!(value instanceof APIError && value.status === 0)) {
            if (!canceled) setError(errorMessage(value));
            return;
          }
          const savedWorks = await offlineWorkSummaries();
          if (canceled) return;
          setContinuing(savedWorks.filter((work) => work.in_progress).slice(0, 6));
          setRecent(savedWorks.slice(0, 8));
          setWantToRead(
            savedWorks.filter((work) => work.reading_status === 'want_to_read').slice(0, 6),
          );
          setFinished(savedWorks.filter((work) => work.reading_status === 'finished').slice(0, 6));
          setReady([]);
          setReadyWorks({});
          setCollections([]);
          setOffline(true);
          setError(savedWorks.length ? '' : errorMessage(value));
        } finally {
          if (!canceled) setLoading(false);
        }
      }
      void load();
      return () => {
        canceled = true;
      };
    }, []),
  );

  if (loading) {
    return (
      <Page title="Home" hideHeader>
        <LoadingState label="Loading your books…" />
      </Page>
    );
  }

  const hasContent =
    continuing.length ||
    ready.length ||
    recent.length ||
    wantToRead.length ||
    finished.length ||
    collections.length;

  return (
    <Page title="Home" hideHeader>
      {offline ? <Notice>Offline · showing books downloaded to this device.</Notice> : null}
      {error ? <Notice danger>{error}</Notice> : null}
      {!hasContent ? (
        <EmptyState
          icon="search"
          title="Find something to read or listen to"
          action={
            <Button
              label="Search for a book"
              icon="search"
              kind="primary"
              onPress={() => router.push('/books')}
            />
          }
        >
          Available books and completed requests will appear here.
        </EmptyState>
      ) : (
        <View className="gap-9">
          {continuing.length ? (
            <Section title="Continue">
              <ContinueShelf works={continuing} />
            </Section>
          ) : null}
          {ready.length ? (
            <Section
              title="Ready for you"
              action={
                <Button
                  label="View activity"
                  kind="quiet"
                  onPress={() => router.push('/activity')}
                />
              }
            >
              <View className="max-w-[900px]">
                {ready.map((item) => (
                  <ReadyRow key={item.id} item={item} work={readyWorks[item.work_id ?? '']} />
                ))}
              </View>
            </Section>
          ) : null}
          {recent.length ? (
            <Section
              title="Recently added"
              action={
                <Button label="Browse all" kind="quiet" onPress={() => router.push('/books')} />
              }
            >
              <WorkShelf works={recent} />
            </Section>
          ) : null}
          {wantToRead.length ? (
            <Section
              title="Want to read or listen"
              action={
                <Button
                  label="Browse all"
                  kind="quiet"
                  onPress={() => router.push('/books?status=want_to_read')}
                />
              }
            >
              <WorkShelf works={wantToRead} />
            </Section>
          ) : null}
          {finished.length ? (
            <Section
              title="Finished"
              action={
                <Button
                  label="Browse all"
                  kind="quiet"
                  onPress={() => router.push('/books?status=finished')}
                />
              }
            >
              <WorkShelf works={finished} />
            </Section>
          ) : null}
          {collections.length ? (
            <Section
              title="Collections"
              action={
                <Button label="View all" kind="quiet" onPress={() => router.push('/collections')} />
              }
            >
              <View className="max-w-[900px]">
                {collections.map((collection) => (
                  <CollectionRow key={collection.id} item={collection} />
                ))}
              </View>
            </Section>
          ) : null}
        </View>
      )}
    </Page>
  );
}
