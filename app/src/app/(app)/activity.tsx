import { useTitleRequests } from '@/features/use-title-requests';
import type { Href } from 'expo-router';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification, TitleRequest, TitleRequestEvent } from '@/generated/api';
import {
  groupNotifications,
  isCancelableRequestState,
  isTakingLonger,
  requestGroup,
  type NotificationGroup,
  type RequestFilter,
} from '@/features/activity-presentation';
import { useAuth } from '@/features/auth/AuthProvider';
import { BookCover } from '@/features/bookshelf';
import { AppIcon } from '@/features/icons';
import {
  notificationHref,
  notificationIcon,
  notificationTime,
} from '@/features/notification-presentation';
import { RequestTimeline } from '@/features/request-timeline';
import { colors } from '@/features/theme';
import { titleRequestDetail, titleRequestPresentation } from '@/features/title-search';
import { Pressable, Text, View } from '@/features/tw';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  Notice,
  Section,
  StatusBadge,
} from '@/features/ui';
import { api, errorMessage } from '@/lib/api';

function ActivityRow({
  group,
  busy,
  onRead,
}: {
  group: NotificationGroup;
  busy: boolean;
  onRead: (group: NotificationGroup) => void;
}) {
  const item = group.latest;
  const href = notificationHref(item.action_url);
  const unread = group.unreadCount > 0;
  const actionLabel = group.requestID ? 'View request' : href ? 'Open' : unread ? 'Mark read' : '';

  return (
    <View className={`flex-row gap-3 border-b border-line px-2 py-4 ${unread ? 'bg-paper' : ''}`}>
      <View className="relative h-11 w-9 flex-none items-center justify-center">
        <AppIcon
          name={notificationIcon(item.kind)}
          size={21}
          color={unread ? colors.accent : colors.muted}
        />
        {unread ? (
          <View
            accessibilityElementsHidden
            className="absolute right-0 top-1 h-1.5 w-1.5 rounded-full bg-accent"
          />
        ) : null}
      </View>
      <View className="min-w-0 flex-1 gap-2 sm:flex-row sm:items-center sm:justify-between">
        <View className="min-w-0 gap-1 sm:flex-1">
          <Text className="font-editorial-bold text-base leading-5 text-ink">{group.title}</Text>
          <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
            <Text
              className={`text-sm leading-5 ${unread ? 'font-sans-bold text-ink' : 'text-muted'}`}
            >
              {item.title}
            </Text>
            {group.format ? (
              <Text className="text-sm text-muted">· {formatLabel(group.format)}</Text>
            ) : null}
          </View>
          <Text className="text-xs text-muted">
            {notificationTime(item.created_at)}
            {group.items.length > 1 ? ` · ${group.items.length} updates` : ''}
          </Text>
        </View>
        {actionLabel ? (
          <View className="flex-none self-start sm:self-center">
            <Button
              label={actionLabel}
              kind="quiet"
              disabled={busy}
              onPress={() => onRead(group)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function ActivityScreen() {
  const auth = useAuth();
  const [items, setItems] = useState<Notification[]>([]);

  const [requestEvents, setRequestEvents] = useState<Record<string, TitleRequestEvent[]>>({});
  const [expandedFormat, setExpandedFormat] = useState('');
  const [historyLoadingID, setHistoryLoadingID] = useState('');
  const [tab, setTab] = useState<'requests' | 'updates'>('requests');
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('active');
  const params = useLocalSearchParams<{ request?: string; library?: string; format?: string }>();
  const requestPages = useTitleRequests(requestFilter, true, params.request, params.library);
  const requests = requestPages.items;
  const loadGeneration = useRef(0);

  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyID, setBusyID] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{
    request: TitleRequest;
    format: string;
  } | null>(null);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const result = await api.notifications();
      if (generation !== loadGeneration.current) return;
      setItems(result.items);
      setUnreadCount(result.unread_count);
      setError('');
    } catch (value) {
      if (generation === loadGeneration.current) setError(errorMessage(value));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (auth.user?.id) void load();
      return () => {
        loadGeneration.current++;
      };
    }, [load, auth.user?.id]),
  );

  useEffect(() => {
    let current = true;
    if (!params.request || !params.library) return;
    void api
      .titleRequest(params.library, params.request)
      .then((request) => {
        if (!current) return;
        setTab('requests');
        setRequestFilter(requestGroup(request));
        setExpandedFormat(
          `${request.id}:${params.format || request.formats[0]?.format || 'ebook'}`,
        );
      })
      .catch((value) => {
        if (current) setError(errorMessage(value));
      });
    return () => {
      current = false;
    };
  }, [params.request, params.library, params.format]);

  const expandedRequest = requests.find((request) => expandedFormat.startsWith(`${request.id}:`));
  const expandedID = expandedRequest?.id;
  const expandedLibrary = expandedRequest?.library_id;
  const expandedUpdated = expandedRequest?.updated_at;
  useEffect(() => {
    let current = true;
    if (!expandedID || !expandedLibrary) return;
    void api
      .titleRequestEvents(expandedLibrary, expandedID)
      .then((events) => {
        if (current) setRequestEvents((value) => ({ ...value, [expandedID]: events }));
      })
      .catch((value) => {
        if (current) setError(errorMessage(value));
      })
      .finally(() => {
        if (current) setHistoryLoadingID('');
      });
    return () => {
      current = false;
    };
  }, [expandedID, expandedLibrary, expandedUpdated]);

  async function handleCancel() {
    if (!cancelTarget) return;
    setCanceling(true);
    setError('');
    try {
      await api.cancelTitleRequest(
        cancelTarget.request.library_id,
        cancelTarget.request.id,
        cancelTarget.format,
      );
      setCancelTarget(null);
      await Promise.all([load(), requestPages.refresh()]);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setCanceling(false);
    }
  }

  async function toggleRequestHistory(request: TitleRequest, format: string, open = false) {
    const key = `${request.id}:${format}`;
    setExpandedFormat(expandedFormat === key && !open ? '' : key);
  }

  async function handleNotification(group: NotificationGroup) {
    const href = notificationHref(group.latest.action_url);
    const unreadIDs = group.items.filter((item) => !item.read_at).map((item) => item.id);
    if (unreadIDs.length > 0) {
      setBusyID(group.key);
      setError('');
      try {
        await Promise.all(unreadIDs.map((id) => api.markNotificationRead(id)));
        const readAt = new Date().toISOString();
        const ids = new Set(unreadIDs);
        setItems((current) =>
          current.map((candidate) =>
            ids.has(candidate.id) ? { ...candidate, read_at: readAt } : candidate,
          ),
        );
        setUnreadCount((count) => Math.max(0, count - unreadIDs.length));
      } catch (value) {
        setError(errorMessage(value));
        await load();
        return;
      } finally {
        setBusyID('');
      }
    }

    if (group.requestID) {
      const request = requests.find((candidate) => candidate.id === group.requestID);
      if (request) {
        setRequestFilter(requestGroup(request));
        setTab('requests');
        if (group.format) await toggleRequestHistory(request, group.format, true);
        return;
      }
    }
    if (href) router.push(href as Href);
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    setError('');
    try {
      await api.markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
      setUnreadCount(0);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setMarkingAll(false);
    }
  }

  if (loading) return <LoadingState label="Loading activity…" />;

  if (error && items.length === 0 && requests.length === 0) {
    return (
      <Page title="Activity">
        <ErrorState
          title="Activity is unavailable"
          action={<Button label="Try again" kind="secondary" onPress={() => void load()} />}
        >
          {error}
        </ErrorState>
      </Page>
    );
  }

  const visibleRequests = requests.filter(
    (request) => requestGroup(request) === requestFilter || request.id === params.request,
  );
  const notificationGroups = groupNotifications(items);
  const unreadGroups = notificationGroups.filter((group) => group.unreadCount > 0).length;

  return (
    <Page title="Activity">
      {error || requestPages.error ? <Notice danger>{error || requestPages.error}</Notice> : null}
      {requestPages.error ? (
        <Button
          label="Retry requests"
          kind="secondary"
          onPress={() => void requestPages.refresh()}
        />
      ) : null}
      <View
        accessibilityLabel="Activity sections"
        accessibilityRole="tablist"
        className="mb-6 flex-row border-b border-line"
      >
        <ActivityTab
          label="Requests"
          selected={tab === 'requests'}
          onPress={() => setTab('requests')}
        />
        <ActivityTab
          label={unreadGroups > 0 ? `Updates (${unreadGroups})` : 'Updates'}
          selected={tab === 'updates'}
          onPress={() => setTab('updates')}
        />
      </View>
      {tab === 'requests' ? (
        <Section title={`${requestFilter[0].toUpperCase() + requestFilter.slice(1)} requests`}>
          <View
            accessibilityLabel="Filter requests"
            accessibilityRole="radiogroup"
            className="flex-row flex-wrap gap-1"
          >
            {(['active', 'ready', 'history'] as const).map((filter) => (
              <FilterTab
                key={filter}
                label={filter[0].toUpperCase() + filter.slice(1)}
                selected={requestFilter === filter}
                onPress={() => setRequestFilter(filter)}
              />
            ))}
          </View>
          {requestPages.loading && requests.length === 0 ? (
            <LoadingState label="Loading requests…" />
          ) : visibleRequests.length === 0 ? (
            <EmptyState
              icon={requestFilter === 'ready' ? 'check' : 'acquire'}
              title={requestFilter === 'active' ? 'No active requests' : `No ${requestFilter} yet`}
            >
              {requestFilter === 'active'
                ? 'Request a missing ebook or audiobook from Discover.'
                : 'Requests will move here as their status changes.'}
            </EmptyState>
          ) : (
            <View accessibilityRole="list" className="border-t border-line">
              {visibleRequests.map((request) => (
                <View key={request.id} className="flex-row gap-4 border-b border-line py-5">
                  <BookCover
                    title={request.title}
                    author={request.author}
                    coverURL={request.cover_url}
                    size="mini"
                  />
                  <View className="min-w-0 flex-1 gap-3">
                    <View className="gap-0.5">
                      <Text
                        numberOfLines={2}
                        className="font-editorial-bold text-lg leading-6 text-ink"
                      >
                        {request.title}
                      </Text>
                      {request.author ? (
                        <Text numberOfLines={1} className="text-sm text-muted">
                          {request.author}
                        </Text>
                      ) : null}
                    </View>
                    {request.formats.map((format) => {
                      const status = titleRequestPresentation(format.state) ?? {
                        label: 'In progress',
                        tone: 'info' as const,
                      };
                      const key = `${request.id}:${format.format}`;
                      const expanded = expandedFormat === key;
                      return (
                        <View
                          key={format.format}
                          className="gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0"
                        >
                          <View className="gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <View className="min-w-0 gap-1 sm:flex-1">
                              <View className="flex-row flex-wrap items-center gap-2">
                                <Text className="text-sm font-sans-bold text-ink">
                                  {formatLabel(format.format)}
                                </Text>
                                <StatusBadge tone={status.tone} label={status.label} />
                                <Text className="text-xs text-subtle">
                                  {notificationTime(format.updated_at)}
                                </Text>
                              </View>
                              <Text className="text-sm leading-5 text-muted">
                                {titleRequestDetail(format)}
                              </Text>
                              {isTakingLonger(format.state, format.updated_at) ? (
                                <View className="flex-row items-start gap-2 bg-warning-soft px-3 py-2">
                                  <AppIcon name="warning" size={17} color={colors.warning} />
                                  <Text className="min-w-0 flex-1 text-sm leading-5 text-ink">
                                    This download is taking longer than expected. Aldus will keep
                                    checking it.
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <View className="flex-row flex-wrap items-center gap-1">
                              {format.state === 'available' && request.work_id ? (
                                <Button
                                  label={format.format === 'audiobook' ? 'Listen' : 'Read'}
                                  kind="secondary"
                                  onPress={() =>
                                    router.push(
                                      `/consume/${request.work_id}?mode=${
                                        format.format === 'audiobook' ? 'listen' : 'read'
                                      }` as Href,
                                    )
                                  }
                                />
                              ) : null}
                              {format.state === 'available' && !request.work_id ? (
                                <Text className="self-center text-xs text-muted">
                                  Open will appear when import finishes.
                                </Text>
                              ) : null}
                              {['failed', 'denied', 'canceled'].includes(format.state) ? (
                                <Button
                                  label="Find again"
                                  kind="secondary"
                                  onPress={() =>
                                    router.push(
                                      `/search?q=${encodeURIComponent(request.title)}` as Href,
                                    )
                                  }
                                />
                              ) : null}
                              {isCancelableRequestState(format.state) ? (
                                <Button
                                  label="Cancel"
                                  kind="quiet"
                                  onPress={() =>
                                    setCancelTarget({ request, format: format.format })
                                  }
                                />
                              ) : null}
                              <Button
                                label={expanded ? 'Hide updates' : 'View updates'}
                                kind="quiet"
                                loading={historyLoadingID === request.id}
                                onPress={() => void toggleRequestHistory(request, format.format)}
                              />
                            </View>
                          </View>
                          {expanded ? (
                            <RequestTimeline
                              events={requestEvents[request.id] ?? []}
                              format={format.format}
                            />
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
          {requestPages.hasMore ? (
            <Button
              label="Show more requests"
              kind="secondary"
              loading={requestPages.loading}
              onPress={() => void requestPages.loadMore()}
            />
          ) : null}
        </Section>
      ) : items.length > 0 ? (
        <Section
          title={unreadGroups > 0 ? `${unreadGroups} new` : 'Recent'}
          action={
            unreadCount > 0 ? (
              <Button
                label="Mark all read"
                kind="quiet"
                loading={markingAll}
                onPress={() => void handleMarkAllRead()}
              />
            ) : undefined
          }
        >
          <View accessibilityRole="list">
            {notificationGroups.map((group) => (
              <ActivityRow
                key={group.key}
                group={group}
                busy={busyID === group.key}
                onRead={(value) => void handleNotification(value)}
              />
            ))}
          </View>
        </Section>
      ) : (
        <EmptyState icon="activity" title="No updates yet">
          Download, approval, and ready updates will appear here.
        </EmptyState>
      )}
      <ConfirmDialog
        visible={Boolean(cancelTarget)}
        title={`Cancel ${cancelTarget ? formatLabel(cancelTarget.format).toLowerCase() : ''} request?`}
        description="Aldus will stop looking for this format. Downloads created for this request may be removed; reused torrents and saved library books are kept. You can request it again later."
        confirmLabel="Cancel request"
        busy={canceling}
        danger
        onConfirm={() => void handleCancel()}
        onClose={() => setCancelTarget(null)}
      />
    </Page>
  );
}

function formatLabel(format: string) {
  return format === 'audiobook' ? 'Audiobook' : 'Ebook';
}

function ActivityTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center border-b-2 px-4 ${
        selected ? 'border-accent' : 'border-transparent'
      }`}
      onPress={onPress}
    >
      <Text className={`text-sm font-sans-bold ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function FilterTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={`min-h-11 justify-center rounded-control border px-3 ${
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-paper'
      }`}
      onPress={onPress}
    >
      <Text className={`text-sm font-sans-semibold ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
