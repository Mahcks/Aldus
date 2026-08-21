import type { Collection, Notification, WorkSummary } from '../../generated/api';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BookCover, coverPresentation, WorkRow } from '../../features/bookshelf';
import { requestNotification } from '../../features/activity-presentation';
import { collectionCount } from '../../features/collection-presentation';
import { AppIcon } from '../../features/icons';
import { notificationHref } from '../../features/notification-presentation';
import { colors } from '../../features/theme';
import { Pressable, Text, View } from '../../features/tw';
import {
  Button,
  EmptyState,
  LoadingState,
  Notice,
  Page,
  resolvePressStateClass,
  Section,
} from '../../features/ui';
import { APIError, api, errorMessage } from '../../lib/api';
import { offlineWorkSummaries } from '../../lib/offline-library';

function WorkList({ works, continuing }: { works: WorkSummary[]; continuing?: boolean }) {
  return (
    <View className="max-w-[900px]">
      {works.map((work) => {
        const mode = work.last_mode || (work.readable ? 'read' : 'listen');
        return (
          <WorkRow
            key={work.id}
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            coverPresentation={coverPresentation(work)}
            availability={work}
            progress={work.in_progress ? `${work.completion_percent}% complete` : undefined}
            onPress={() =>
              router.push(
                `/work/${work.id}?libraryId=${work.library_id}&role=${work.library_role ?? ''}`,
              )
            }
            action={
              continuing ? (
                <Button
                  label={mode === 'read' ? 'Continue reading' : 'Continue listening'}
                  kind="quiet"
                  onPress={() => router.push(`/consume/${work.id}?mode=${mode}`)}
                />
              ) : undefined
            }
          />
        );
      })}
    </View>
  );
}

function ReadyRow({ item }: { item: Notification }) {
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
    <View className="flex-row items-center gap-4 border-b border-line py-4">
      <BookCover title={title} size="mini" />
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={2} className="font-editorial text-lg font-bold text-ink">
          {title}
        </Text>
        <View className="flex-row items-center gap-2">
          <AppIcon name="check" size={17} color={colors.success} />
          <Text className="text-sm font-semibold text-success">
            {format === 'audiobook' ? 'Your audiobook is ready' : 'Your ebook is ready'}
          </Text>
        </View>
        <Text className="text-sm text-muted">
          {canConsume
            ? format === 'audiobook'
              ? 'Start listening whenever you’re ready.'
              : 'Start reading whenever you’re ready.'
            : 'A book you requested is now in Aldus.'}
        </Text>
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
        <Text numberOfLines={1} className="font-editorial text-base font-bold text-ink">
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
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
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
        setContinuing(progressPage.items);
        setRecent(recentPage.items);
        setWantToRead(wantPage.items);
        setFinished(finishedPage.items);
        setReady(
          inbox.items
            .filter(
              (item) => /ready|available/.test(item.kind) && notificationHref(item.action_url),
            )
            .slice(0, 5),
        );
        setCollections(savedCollections.slice(0, 5));
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
        setOffline(true);
        if (!savedWorks.length) setError(errorMessage(value));
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

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
              onPress={() => router.push('/search')}
            />
          }
        >
          Available books and completed requests will appear here.
        </EmptyState>
      ) : (
        <View className="gap-9">
          {continuing.length ? (
            <Section title="Continue">
              <WorkList works={continuing} continuing />
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
                  <ReadyRow key={item.id} item={item} />
                ))}
              </View>
            </Section>
          ) : null}
          {recent.length ? (
            <Section
              title="Recently added"
              action={
                <Button label="Search all" kind="quiet" onPress={() => router.push('/search')} />
              }
            >
              <WorkList works={recent} />
            </Section>
          ) : null}
          {wantToRead.length ? (
            <Section title="Want to read or listen">
              <WorkList works={wantToRead} />
            </Section>
          ) : null}
          {finished.length ? (
            <Section title="Finished">
              <WorkList works={finished} />
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
