import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import type { Notification, TitleRequest } from '../../generated/api';
import { useAuth } from '../../features/auth/AuthProvider';
import { AppIcon } from '../../features/icons';
import {
  notificationHref,
  notificationIcon,
  notificationTime,
} from '../../features/notification-presentation';
import { colors } from '../../features/theme';
import { titleRequestPresentation } from '../../features/title-search';
import { Text, View } from '../../features/tw';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  Section,
  StatusBadge,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

function ActivityRow({
  item,
  busy,
  onRead,
}: {
  item: Notification;
  busy: boolean;
  onRead: (item: Notification) => void;
}) {
  const href = notificationHref(item.action_url);
  const unread = !item.read_at;
  const actionLabel = href ? 'Open' : unread ? 'Mark read' : '';

  return (
    <View className={`flex-row gap-3 border-b border-line py-4 ${unread ? 'bg-paper' : ''}`}>
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
      <View className="min-w-0 flex-1 gap-1">
        <Text
          className={`text-base leading-5 text-ink ${unread ? 'font-extrabold' : 'font-semibold'}`}
        >
          {item.title}
        </Text>
        {item.body ? <Text className="text-sm leading-5 text-muted">{item.body}</Text> : null}
        <Text className="text-xs text-muted">{notificationTime(item.created_at)}</Text>
      </View>
      {actionLabel ? (
        <View className="flex-none self-center">
          <Button label={actionLabel} kind="quiet" disabled={busy} onPress={() => onRead(item)} />
        </View>
      ) : null}
    </View>
  );
}

export default function ActivityScreen() {
  const auth = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [requests, setRequests] = useState<TitleRequest[]>([]);
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

  async function load() {
    try {
      const [result, libraries] = await Promise.all([api.notifications(), api.libraries()]);
      const libraryRequests = await Promise.all(
        libraries.map((library) => api.titleRequests(library.id)),
      );
      setItems(result.items);
      setUnreadCount(result.unread_count);
      setRequests(
        libraryRequests
          .flat()
          .filter((request) => request.requested_by === auth.user?.id)
          .filter((request) => request.formats.some((format) => isActive(format.state))),
      );
      setError('');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let canceled = false;
    Promise.all([api.notifications(), api.libraries()])
      .then(async ([result, libraries]) => {
        const libraryRequests = await Promise.all(
          libraries.map((library) => api.titleRequests(library.id)),
        );
        if (canceled) return;
        setItems(result.items);
        setUnreadCount(result.unread_count);
        setRequests(
          libraryRequests
            .flat()
            .filter((request) => request.requested_by === auth.user?.id)
            .filter((request) => request.formats.some((format) => isActive(format.state))),
        );
      })
      .catch((value: unknown) => {
        if (!canceled) setError(errorMessage(value));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [auth.user?.id]);

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
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setCanceling(false);
    }
  }

  async function handleNotification(item: Notification) {
    const href = notificationHref(item.action_url);
    if (!item.read_at) {
      setBusyID(item.id);
      setError('');
      try {
        await api.markNotificationRead(item.id);
        const readAt = new Date().toISOString();
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, read_at: readAt } : candidate,
          ),
        );
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch (value) {
        setError(errorMessage(value));
        return;
      } finally {
        setBusyID('');
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
      <Page title="Activity" hideHeader>
        <ErrorState
          title="Activity is unavailable"
          action={<Button label="Try again" kind="secondary" onPress={() => void load()} />}
        >
          {error}
        </ErrorState>
      </Page>
    );
  }

  return (
    <Page title="Activity" hideHeader>
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      {items.length === 0 && requests.length === 0 ? (
        <EmptyState icon="acquire" title="Nothing here yet">
          Updates about requests and newly available books will appear here.
        </EmptyState>
      ) : null}
      {requests.length > 0 ? (
        <Section title="Your requests">
          <View accessibilityRole="list" className="border-t border-line">
            {requests.map((request) => (
              <View key={request.id} className="gap-3 border-b border-line py-4">
                <View className="gap-1">
                  <Text className="font-editorial text-lg font-bold text-ink">{request.title}</Text>
                  {request.author ? (
                    <Text className="text-sm text-muted">{request.author}</Text>
                  ) : null}
                </View>
                {request.formats
                  .filter((format) => isActive(format.state))
                  .map((format) => {
                    const status = titleRequestPresentation(format.state) ?? {
                      label: 'In progress',
                      tone: 'info' as const,
                    };
                    return (
                      <View
                        key={format.format}
                        className="min-h-11 gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <View className="flex-row items-center gap-3">
                          <Text className="w-24 text-sm font-bold text-ink">
                            {formatLabel(format.format)}
                          </Text>
                          <StatusBadge tone={status.tone} label={status.label} />
                        </View>
                        <Button
                          label="Cancel"
                          kind="quiet"
                          onPress={() => setCancelTarget({ request, format: format.format })}
                        />
                      </View>
                    );
                  })}
              </View>
            ))}
          </View>
        </Section>
      ) : null}
      {items.length > 0 ? (
        <Section
          title={unreadCount > 0 ? `${unreadCount} new` : 'Recent'}
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
            {items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                busy={busyID === item.id}
                onRead={(value) => void handleNotification(value)}
              />
            ))}
          </View>
        </Section>
      ) : null}
      <ConfirmDialog
        visible={Boolean(cancelTarget)}
        title={`Cancel ${cancelTarget ? formatLabel(cancelTarget.format).toLowerCase() : ''} request?`}
        description="Aldus will stop looking for this format. You can request it again later."
        confirmLabel="Cancel request"
        busy={canceling}
        danger
        onConfirm={() => void handleCancel()}
        onClose={() => setCancelTarget(null)}
      />
    </Page>
  );
}

const terminalStates = new Set(['available', 'denied', 'canceled', 'failed']);

function isActive(state: string) {
  return !terminalStates.has(state);
}

function formatLabel(format: string) {
  return format === 'audiobook' ? 'Audiobook' : 'Ebook';
}
