import { useTitleRequests } from '@/hooks/acquisitions/use-title-requests';
import type { Href } from 'expo-router';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification, TitleRequest, TitleRequestEvent } from '@/generated/api';
import {
  groupNotifications,
  isCancelableRequestState,
  isTakingLonger,
  notificationAction,
  personalGroupKey,
  requestGroup,
  type NotificationGroup,
} from '@/lib/activity/activity-presentation';
import { useAuth } from '@/components/auth/AuthProvider';
import { BookCover } from '@/components/catalog/bookshelf';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import {
  notificationHref,
  notificationIcon,
  notificationStatus,
} from '@/lib/activity/notification-presentation';
import {
  setUnreadNotificationCount,
  useUnreadNotificationCount,
} from '@/lib/activity/unread-notifications';
import { RequestTimeline } from '@/components/acquisitions/request-timeline';
import { useThemeColors } from '@/components/ui/theme';
import { titleRequestDetail, titleRequestPresentation } from '@/lib/acquisitions/title-search';
import { relativeTime } from '@/lib/format';
import { Text, View } from '@/components/ui/tw';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Radio,
  Section,
  StatusBadge,
} from '@/components/ui';
import { Page } from '@/components/shell/Page';
import { api, errorMessage } from '@/lib/api';

const NOTIFICATIONS_PAGE_SIZE = 50;

/**
 * One dimension, one control. `active`/`ready`/`history` classify the
 * reader's own requests (unchanged from the old Requests tab); `unread` and
 * `needs_approval` cut across that by read-state and audience instead of
 * lifecycle. There's no second, independent facet to combine them with, so
 * they share a single picker rather than two rows of chips.
 */
type ViewFilter = 'all' | 'unread' | 'active' | 'ready' | 'needs_approval' | 'history';

function emptyStateFor(
  filter: ViewFilter,
  unreadCount: number,
): { icon: AppIconName; title: string; body: string } {
  switch (filter) {
    case 'unread':
      return unreadCount > 0
        ? {
            icon: 'activity',
            title: 'More unread updates below',
            body: 'Load older updates to see the rest.',
          }
        : { icon: 'enabled', title: 'You’re all caught up', body: 'New updates will appear here.' };
    case 'needs_approval':
      return {
        icon: 'enabled',
        title: 'Nothing needs your approval',
        body: 'Requests waiting on a decision will appear here.',
      };
    case 'active':
      return {
        icon: 'acquire',
        title: 'No active requests',
        body: 'Request a missing ebook or audiobook from Discover.',
      };
    case 'ready':
      return {
        icon: 'check',
        title: 'No books ready yet',
        body: 'Finished downloads will appear here.',
      };
    case 'history':
      return {
        icon: 'acquire',
        title: 'No history yet',
        body: 'Requests will move here as their status changes.',
      };
    default:
      return {
        icon: 'activity',
        title: 'Nothing here',
        body: 'Requests and updates about your books will appear here.',
      };
  }
}

/** A stray notification whose request isn't in the currently loaded page — kept visible rather than silently dropped. */
function NotificationRow({
  group,
  coverURL,
  busy,
  onMarkRead,
  onOpen,
}: {
  group: NotificationGroup;
  coverURL?: string;
  busy: boolean;
  onMarkRead: (group: NotificationGroup) => void;
  onOpen: (group: NotificationGroup) => void;
}) {
  const item = group.latest;
  const unread = group.unreadCount > 0;
  const status = notificationStatus(item.kind);
  const action = notificationAction(group);

  return (
    <View className={`flex-row gap-4 border-b border-line py-5 ${unread ? 'bg-paper' : ''}`}>
      <BookCover title={group.title} coverURL={coverURL} size="mini" />
      <View className="min-w-0 flex-1 gap-3 sm:flex-row sm:items-start sm:justify-between">
        <View className="min-w-0 gap-1.5 sm:flex-1">
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="font-editorial-bold text-lg leading-6 text-ink">{group.title}</Text>
            {unread ? (
              <View accessibilityElementsHidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            ) : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-2">
            <StatusBadge
              tone={status.tone}
              label={status.label}
              icon={notificationIcon(item.kind)}
            />
            {group.format ? (
              <Text className="text-xs text-subtle">{formatLabel(group.format)}</Text>
            ) : null}
            <Text className="text-xs text-subtle">{relativeTime(item.created_at)}</Text>
          </View>
          <Text
            className={`text-sm leading-5 ${unread ? 'font-sans-medium text-ink' : 'text-muted'}`}
          >
            {item.title}
            {group.items.length > 1 ? ` · ${group.items.length} updates` : ''}
          </Text>
        </View>
        <View className="flex-none flex-row flex-wrap items-center gap-1.5">
          {unread ? (
            <IconButton
              icon="enabled"
              label={`Mark "${group.title}" read`}
              kind="quiet"
              disabled={busy}
              onPress={() => onMarkRead(group)}
            />
          ) : null}
          {action ? (
            <Button
              label={action.label}
              icon={action.icon}
              kind={action.kind}
              disabled={busy}
              onPress={() => onOpen(group)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function ActivityScreen() {
  const auth = useAuth();
  const colors = useThemeColors();
  const [items, setItems] = useState<Notification[]>([]);

  const [requestEvents, setRequestEvents] = useState<Record<string, TitleRequestEvent[]>>({});
  const [expandedFormat, setExpandedFormat] = useState('');
  const [historyLoadingID, setHistoryLoadingID] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const params = useLocalSearchParams<{ request?: string; library?: string; format?: string }>();
  // Always load everything the reader owns; the filter narrows what's shown
  // client-side instead of re-fetching a different server-side page per tab.
  const requestPages = useTitleRequests('all', true, params.request, params.library);
  const requests = requestPages.items;
  const loadGeneration = useRef(0);

  const unreadCount = useUnreadNotificationCount();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState<{ message: string; retry: () => void } | null>(
    null,
  );
  const [busyID, setBusyID] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [hasMoreUpdates, setHasMoreUpdates] = useState(false);
  const [loadingMoreUpdates, setLoadingMoreUpdates] = useState(false);
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
      setUnreadNotificationCount(result.unread_count);
      setHasMoreUpdates(result.items.length === NOTIFICATIONS_PAGE_SIZE);
      setError('');
    } catch (value) {
      if (generation === loadGeneration.current) setError(errorMessage(value));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  async function loadMoreUpdates() {
    const generation = loadGeneration.current;
    setLoadingMoreUpdates(true);
    setActionError(null);
    try {
      const result = await api.notifications(items.length);
      if (generation !== loadGeneration.current) return;
      setItems((current) => {
        const merged = [...current, ...result.items];
        return [...new Map(merged.map((item) => [item.id, item])).values()];
      });
      setUnreadNotificationCount(result.unread_count);
      setHasMoreUpdates(result.items.length === NOTIFICATIONS_PAGE_SIZE);
    } catch (value) {
      if (generation === loadGeneration.current) {
        setActionError({ message: errorMessage(value), retry: () => void loadMoreUpdates() });
      }
    } finally {
      if (generation === loadGeneration.current) setLoadingMoreUpdates(false);
    }
  }

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
        setViewFilter(requestGroup(request));
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

  /** Marks a group's remaining unread items read. Never navigates — a separate action from opening a destination. */
  async function markGroupRead(group: NotificationGroup): Promise<boolean> {
    const unreadIDs = group.items.filter((item) => !item.read_at).map((item) => item.id);
    if (unreadIDs.length === 0) return true;
    setBusyID(group.key);
    setActionError(null);
    try {
      await Promise.all(unreadIDs.map((id) => api.markNotificationRead(id)));
      const readAt = new Date().toISOString();
      const ids = new Set(unreadIDs);
      setItems((current) =>
        current.map((candidate) =>
          ids.has(candidate.id)
            ? { ...candidate, read_at: candidate.read_at ?? readAt }
            : candidate,
        ),
      );
      setUnreadNotificationCount((count) => count - unreadIDs.length);
      return true;
    } catch (value) {
      setActionError({ message: errorMessage(value), retry: () => void markGroupRead(group) });
      await load();
      return false;
    } finally {
      setBusyID('');
    }
  }

  /** Real art when the notification's request happens to be in the currently loaded page; `BookCover` renders its generated placeholder otherwise. */
  function groupCoverURL(group: NotificationGroup): string | undefined {
    if (!group.requestID) return undefined;
    return requests.find((candidate) => candidate.id === group.requestID)?.cover_url;
  }

  function navigateToGroup(group: NotificationGroup) {
    const href = notificationHref(group.latest.action_url);
    if (!group.administrative && group.requestID) {
      const request = requests.find((candidate) => candidate.id === group.requestID);
      if (request) {
        setViewFilter(requestGroup(request));
        if (group.format) void toggleRequestHistory(request, group.format, true);
        return;
      }
    }
    if (href) router.push(href as Href);
  }

  /** Opening a destination still clears its unread state as a courtesy, but the two are independent: a failed mark-read never blocks navigation, and the explicit "Mark read" control never navigates. */
  function handleOpenGroup(group: NotificationGroup) {
    void markGroupRead(group);
    navigateToGroup(group);
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    setActionError(null);
    try {
      await api.markAllNotificationsRead();
      await load();
    } catch (value) {
      setActionError({ message: errorMessage(value), retry: () => void handleMarkAllRead() });
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

  const notificationGroups = groupNotifications(items);
  const notificationGroupsByKey = new Map(notificationGroups.map((group) => [group.key, group]));
  const administrativeGroups = notificationGroups.filter((group) => group.administrative);

  const matchedGroupKeys = new Set<string>();
  for (const request of requests) {
    for (const format of request.formats) {
      matchedGroupKeys.add(personalGroupKey(request.title, format.format));
    }
  }
  const orphanGroups = notificationGroups.filter(
    (group) => !group.administrative && !matchedGroupKeys.has(group.key),
  );

  function requestUnread(request: TitleRequest): boolean {
    return request.formats.some(
      (format) =>
        (notificationGroupsByKey.get(personalGroupKey(request.title, format.format))?.unreadCount ??
          0) > 0,
    );
  }

  function requestVisible(request: TitleRequest): boolean {
    if (viewFilter === 'needs_approval') return false;
    if (viewFilter === 'unread') return requestUnread(request);
    if (viewFilter === 'all') return true;
    return requestGroup(request) === viewFilter;
  }

  const visibleRequests = requests.filter(requestVisible);

  const showAdmin =
    viewFilter === 'all' || viewFilter === 'unread' || viewFilter === 'needs_approval';
  const visibleAdminGroups = !showAdmin
    ? []
    : viewFilter === 'unread'
      ? administrativeGroups.filter((group) => group.unreadCount > 0)
      : administrativeGroups;

  const showOrphans = viewFilter === 'all' || viewFilter === 'unread';
  const visibleOrphanGroups = !showOrphans
    ? []
    : viewFilter === 'unread'
      ? orphanGroups.filter((group) => group.unreadCount > 0)
      : orphanGroups;

  const viewFilterOptions: { value: ViewFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: unreadCount > 0 ? `Unread (${unreadCount})` : 'Unread' },
    { value: 'active', label: 'Active' },
    { value: 'ready', label: 'Ready' },
    {
      value: 'needs_approval',
      label:
        administrativeGroups.length > 0
          ? `Needs approval (${administrativeGroups.length})`
          : 'Needs approval',
    },
    { value: 'history', label: 'History' },
  ];
  const selectedFilterLabel =
    viewFilterOptions.find((option) => option.value === viewFilter)?.label ?? 'All';

  const hasAnyData = requests.length > 0 || items.length > 0;
  const hasVisibleContent =
    visibleAdminGroups.length > 0 || visibleRequests.length > 0 || visibleOrphanGroups.length > 0;
  const empty = emptyStateFor(viewFilter, unreadCount);

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
      {actionError ? (
        <View className="gap-2">
          <Notice danger>{actionError.message}</Notice>
          <Button label="Retry" kind="secondary" onPress={actionError.retry} />
        </View>
      ) : null}

      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Button
          label={`Filter: ${selectedFilterLabel}`}
          icon="filter"
          kind="secondary"
          onPress={() => setFilterDialogOpen(true)}
        />
        {unreadCount > 0 ? (
          <Button
            label="Mark all read"
            kind="quiet"
            icon="enabled"
            loading={markingAll}
            onPress={() => void handleMarkAllRead()}
          />
        ) : null}
      </View>

      {requestPages.loading && requests.length === 0 && items.length === 0 ? (
        <LoadingState label="Loading requests…" />
      ) : !hasAnyData ? (
        <EmptyState icon="activity" title="No activity yet">
          Requests and updates about your books will appear here.
        </EmptyState>
      ) : !hasVisibleContent ? (
        <EmptyState icon={empty.icon} title={empty.title}>
          {empty.body}
        </EmptyState>
      ) : (
        <View className="gap-2">
          {visibleAdminGroups.length > 0 ? (
            <Section title="Needs your approval">
              <View accessibilityRole="list">
                {visibleAdminGroups.map((group) => (
                  <NotificationRow
                    key={group.key}
                    group={group}
                    coverURL={groupCoverURL(group)}
                    busy={busyID === group.key}
                    onMarkRead={(value) => void markGroupRead(value)}
                    onOpen={handleOpenGroup}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {visibleRequests.length > 0 || visibleOrphanGroups.length > 0 ? (
            <View
              accessibilityRole="list"
              className={visibleAdminGroups.length > 0 ? 'border-t border-line pt-2' : ''}
            >
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
                      const notifGroup = notificationGroupsByKey.get(
                        personalGroupKey(request.title, format.format),
                      );
                      const unread = (notifGroup?.unreadCount ?? 0) > 0;
                      return (
                        <View
                          key={format.format}
                          className="gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0"
                        >
                          <View className="gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <View className="min-w-0 gap-1 sm:flex-1">
                              <View className="flex-row flex-wrap items-center gap-2">
                                <Text className="text-sm font-sans-bold text-ink">
                                  {formatLabel(format.format)}
                                </Text>
                                {unread ? (
                                  <View
                                    accessibilityElementsHidden
                                    className="h-1.5 w-1.5 rounded-full bg-accent"
                                  />
                                ) : null}
                                <StatusBadge
                                  tone={status.tone}
                                  label={status.label}
                                  icon={notificationIcon(format.state)}
                                />
                                <Text className="text-xs text-subtle">
                                  {relativeTime(format.updated_at)}
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
                              {unread && notifGroup ? (
                                <IconButton
                                  icon="enabled"
                                  label={`Mark "${request.title} ${formatLabel(format.format).toLowerCase()}" read`}
                                  kind="quiet"
                                  disabled={busyID === notifGroup.key}
                                  onPress={() => void markGroupRead(notifGroup)}
                                />
                              ) : null}
                              {format.state === 'available' && request.work_id ? (
                                <Button
                                  label={format.format === 'audiobook' ? 'Listen now' : 'Read now'}
                                  accessibilityLabel={`${format.format === 'audiobook' ? 'Listen to' : 'Read'} ${request.title} now`}
                                  icon={format.format === 'audiobook' ? 'listen' : 'read'}
                                  kind="primary"
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
                                  accessibilityLabel={`Find ${request.title} again`}
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
                                  accessibilityLabel={`Cancel ${request.title}, ${formatLabel(format.format)}`}
                                  kind="quiet"
                                  onPress={() =>
                                    setCancelTarget({ request, format: format.format })
                                  }
                                />
                              ) : null}
                              <Button
                                label={expanded ? 'Hide updates' : 'View updates'}
                                accessibilityLabel={`${expanded ? 'Hide' : 'View'} updates for ${request.title}, ${formatLabel(format.format)}`}
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
              {visibleOrphanGroups.map((group) => (
                <NotificationRow
                  key={group.key}
                  group={group}
                  coverURL={groupCoverURL(group)}
                  busy={busyID === group.key}
                  onMarkRead={(value) => void markGroupRead(value)}
                  onOpen={handleOpenGroup}
                />
              ))}
            </View>
          ) : null}
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
      {hasMoreUpdates ? (
        <Button
          label="Load older updates"
          kind="secondary"
          loading={loadingMoreUpdates}
          onPress={() => void loadMoreUpdates()}
        />
      ) : null}

      <Dialog
        title="Filter activity"
        sheet
        visible={filterDialogOpen}
        onClose={() => setFilterDialogOpen(false)}
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="Filter activity" className="gap-1">
          {viewFilterOptions.map((option) => (
            <Radio
              key={option.value}
              label={option.label}
              selected={viewFilter === option.value}
              onPress={() => {
                setViewFilter(option.value);
                setFilterDialogOpen(false);
              }}
            />
          ))}
        </View>
      </Dialog>

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
