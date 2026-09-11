import type { Collection, Notification, Work, WorkSummary } from '@/generated/api';
import type { Href } from 'expo-router';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type PropsWithChildren } from 'react';
import Animated from 'react-native-reanimated';
import { useWindowDimensions } from 'react-native';
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
import { offlineBrowseWorks } from '@/features/offline-browse';
import { workResumeMode } from '@/features/work-resume';
import { workHref, workQuickActions } from '@/features/work-actions';

function greetingForHour(hour: number) {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

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

/**
 * The featured "Continue" book, lifted onto a tinted panel instead of
 * sitting flat on canvas — it's the one thing on the page that should read
 * as a spotlight rather than another shelf.
 */
function ContinueSpotlight({ work }: { work: WorkSummary }) {
  const mode = workResumeMode(work);
  if (!mode) return null;
  return (
    <View className="rounded-card bg-accent-soft p-4">
      <ContinueCard
        title={work.title}
        author={work.author}
        coverURL={
          (mode === 'listen' ? work.audiobook_cover_url : work.ebook_cover_url) || work.cover_url
        }
        fallbackCoverURL={work.cover_url}
        coverPresentation={coverPresentation(work)}
        availability={work}
        progress={workProgressLabel(work.in_progress, work.completion_percent)}
        continueMode={mode}
        size="hero"
        completionPercent={work.completion_percent}
        onRead={work.readable ? () => router.push(`/consume/${work.id}?mode=read`) : undefined}
        onListen={
          work.listenable ? () => router.push(`/consume/${work.id}?mode=listen`) : undefined
        }
        onOpen={() => router.push(workHref(work))}
        onContinue={() => router.push(`/consume/${work.id}?mode=${mode}`)}
        continueHref={`/consume/${work.id}?mode=${mode}`}
        actions={workQuickActions(work)}
      />
    </View>
  );
}

/**
 * The rest of the in-progress books. Capped at 3 (see `continuing.slice(1, 4)`
 * below), so this never needs to scroll — a horizontal `Shelf` with only one
 * or two tiles just leaves a dead, scroll-implying gap on the right. A
 * wrapping row sizes itself to however many books there actually are.
 */
function UpNextShelf({ works }: { works: WorkSummary[] }) {
  const tileWidth = Math.min(184, (useWindowDimensions().width - 48) / 2);
  return (
    <View className="flex-row flex-wrap items-start gap-4">
      {works.map((work, index) => {
        const mode = workResumeMode(work);
        return (
          <Animated.View key={work.id} entering={listItemEnter(index)} style={{ width: tileWidth }}>
            <WorkCard
              narrow
              title={work.title}
              author={work.author}
              coverURL={
                (mode === 'listen' ? work.audiobook_cover_url : work.ebook_cover_url) ||
                work.cover_url
              }
              fallbackCoverURL={work.cover_url}
              coverPresentation={coverPresentation(work)}
              availability={{
                readable: mode === 'read',
                listenable: mode === 'listen',
                synchronized: false,
              }}
              progress={workProgressLabel(work.in_progress, work.completion_percent)}
              onPress={() =>
                router.push(mode ? `/consume/${work.id}?mode=${mode}` : workHref(work))
              }
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Same press-and-hold quick-action menu as `ContinueCard`, native menu included — "any book", not just Continue's. */
function WorkShelf({ works }: { works: WorkSummary[] }) {
  const tileWidth = Math.min(184, (useWindowDimensions().width - 48) / 2);
  return (
    <Shelf>
      {works.map((work, index) => (
        <Animated.View key={work.id} entering={listItemEnter(index)} style={{ width: tileWidth }}>
          <WorkCard
            narrow
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            coverPresentation={coverPresentation(work)}
            availability={work}
            progress={workProgressLabel(work.in_progress, work.completion_percent)}
            href={workHref(work)}
            actions={workQuickActions(work)}
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

/** Fixed-scale grid card — a library shelf reads better as tiles than as another stacked list. */
function CollectionCard({ item }: { item: Collection }) {
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
      className={`min-h-11 grow basis-[47%] flex-row items-center gap-3 rounded-card border border-line bg-paper p-3 shadow-xs ${resolvePressStateClass({ focused, pressed })}`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-pill bg-accent-soft">
        <AppIcon name="collections" size={18} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-sans-semibold text-sm text-ink">
          {item.title}
        </Text>
        <Text className="text-xs text-muted">{collectionCount(item.work_count)}</Text>
      </View>
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
  const [shelfTab, setShelfTab] = useState<'want' | 'finished'>('want');

  useFocusEffect(
    useCallback(() => {
      let canceled = false;
      async function load() {
        try {
          const [progressPage, recentPage, wantPage, finishedPage, inbox, savedCollections] =
            await Promise.all([
              api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 4 }),
              api.browseWorks({ sort: 'recent', limit: 8 }),
              api.browseWorks({ status: 'want_to_read', sort: 'updated', limit: 6 }),
              api.browseWorks({ status: 'finished', sort: 'updated', limit: 6 }),
              api.notifications().catch(() => ({ items: [], unread_count: 0 })),
              api.collections().catch(() => []),
            ]);
          if (canceled) return;
          setError('');
          setOffline(false);
          setContinuing(progressPage.items.filter((work) => workResumeMode(work)));
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
          setContinuing(
            offlineBrowseWorks(savedWorks, {
              availability: 'in_progress',
              sort: 'progress',
              status: '',
            })
              .filter((work) => workResumeMode(work))
              .slice(0, 4),
          );
          setRecent(
            offlineBrowseWorks(savedWorks, {
              availability: 'all',
              sort: 'recent',
              status: '',
            }).slice(0, 8),
          );
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

  const greeting = greetingForHour(new Date().getHours());
  const summaryParts = [
    continuing.length ? 'Pick up where you left off' : '',
    ready.length ? 'New books ready for you' : '',
  ].filter(Boolean);

  const showShelfTabs = wantToRead.length > 0 && finished.length > 0;
  const activeShelfTab = showShelfTabs ? shelfTab : wantToRead.length ? 'want' : 'finished';
  const activeShelfWorks = activeShelfTab === 'want' ? wantToRead : finished;

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
        <View className="gap-7">
          <View className="gap-1">
            <Text className="font-editorial text-[26px] text-ink">{greeting}</Text>
            {summaryParts.length ? (
              <Text className="text-sm text-muted">{summaryParts.join(' · ')}</Text>
            ) : null}
          </View>
          {continuing.length ? <ContinueSpotlight work={continuing[0]} /> : null}
          {continuing.length > 1 ? (
            <Section
              title="Up next"
              action={
                <Button
                  label="See all"
                  kind="quiet"
                  onPress={() => router.push('/books?status=in_progress')}
                />
              }
            >
              <UpNextShelf works={continuing.slice(1, 4)} />
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
              <View className="max-w-[900px] rounded-card border border-line bg-paper p-3 shadow-xs">
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
          {wantToRead.length || finished.length ? (
            <View className="gap-3">
              <View className="min-h-11 flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
                {showShelfTabs ? (
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Shelf"
                    className="flex-row items-center gap-2"
                  >
                    <Button
                      label="Want to read"
                      kind="secondary"
                      selected={activeShelfTab === 'want'}
                      accessibilityRole="radio"
                      onPress={() => setShelfTab('want')}
                    />
                    <Button
                      label="Finished"
                      kind="secondary"
                      selected={activeShelfTab === 'finished'}
                      accessibilityRole="radio"
                      onPress={() => setShelfTab('finished')}
                    />
                  </View>
                ) : (
                  <Text accessibilityRole="header" className="text-lg font-sans-bold text-ink">
                    {wantToRead.length ? 'Want to read or listen' : 'Finished'}
                  </Text>
                )}
                <Button
                  label="Browse all"
                  kind="quiet"
                  onPress={() =>
                    router.push(
                      `/books?status=${activeShelfTab === 'want' ? 'want_to_read' : 'finished'}`,
                    )
                  }
                />
              </View>
              <WorkShelf works={activeShelfWorks} />
            </View>
          ) : null}
          {collections.length ? (
            <Section
              title="Collections"
              action={
                <Button label="View all" kind="quiet" onPress={() => router.push('/collections')} />
              }
            >
              <View className="max-w-[900px] flex-row flex-wrap gap-3">
                {collections.map((collection) => (
                  <CollectionCard key={collection.id} item={collection} />
                ))}
              </View>
            </Section>
          ) : null}
        </View>
      )}
    </Page>
  );
}
