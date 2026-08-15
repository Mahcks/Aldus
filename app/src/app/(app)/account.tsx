import type { Library, WorkSummary } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import Animated from 'react-native-reanimated';
import { useAuth } from '../../features/auth/AuthProvider';
import { formatDuration } from '../../features/format';
import { AppIcon } from '../../features/icons';
import { listItemEnter } from '../../features/motion';
import { Text, View } from '../../features/tw';
import {
  Button,
  colors,
  EmptyState,
  IconRow,
  Loading,
  Notice,
  Page,
  Section,
  StatusBadge,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

export default function AccountScreen() {
  const auth = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [activity, setActivity] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;
    Promise.all([
      api.libraries(),
      api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 100 }),
    ])
      .then(([items, works]) => {
        if (!canceled) {
          setLibraries(items);
          setActivity(works.items);
        }
      })
      .catch((value) => {
        if (!canceled) setError(errorMessage(value));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  async function signOut() {
    await auth.signOut();
    router.replace('/login');
  }

  const readingSeconds = activity.reduce((total, work) => total + work.reading_seconds, 0);
  const listeningSeconds = activity.reduce((total, work) => total + work.listening_seconds, 0);

  return (
    <Page title="Account" actions={<Button label="Sign out" kind="secondary" onPress={signOut} />}>
      {error ? <Notice danger>{error}</Notice> : null}
      <View className="max-w-[680px] gap-8">
        <Section title="Profile">
          <View className="gap-3 border-b border-line pb-5">
            <View className="flex-row items-center gap-4">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <AppIcon name="account" size={26} color={colors.accent} />
              </View>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-lg font-bold text-ink">
                  {auth.user?.display_name || auth.user?.username}
                </Text>
                <Text numberOfLines={1} className="text-sm text-muted">
                  @{auth.user?.username}
                </Text>
              </View>
            </View>
            {auth.user?.admin ? (
              <StatusBadge tone="info" label="Administrator" icon="users" />
            ) : null}
          </View>
        </Section>
        <Section title="Your activity">
          {activity.length ? (
            <View className="gap-4">
              <View className="flex-row gap-8 border-b border-line pb-4">
                <ActivityStat label="Reading" seconds={readingSeconds} />
                <ActivityStat label="Listening" seconds={listeningSeconds} />
                <View>
                  <Text className="text-2xl font-bold text-ink">{activity.length}</Text>
                  <Text className="text-xs text-muted">In progress</Text>
                </View>
              </View>
              <View className="gap-2">
                {activity.map((work, index) => (
                  <Animated.View key={work.id} entering={listItemEnter(index)}>
                    <IconRow
                      icon={work.last_mode === 'listen' ? 'listen' : 'read'}
                      title={work.title}
                      subtitle={`${work.completion_percent}% complete · ${formatDuration(work.active_seconds)}`}
                      onPress={() =>
                        router.push(
                          `/consume/${work.id}?mode=${work.last_mode || (work.readable ? 'read' : 'listen')}`,
                        )
                      }
                    />
                  </Animated.View>
                ))}
              </View>
            </View>
          ) : loading ? (
            <Loading label="Loading activity…" />
          ) : (
            <EmptyState title="No reading activity yet">
              Open a book or audiobook to begin tracking your time.
            </EmptyState>
          )}
        </Section>
        <Section title="Your libraries">
          {loading ? (
            <Loading label="Loading libraries…" />
          ) : libraries.length ? (
            <View className="gap-3">
              {libraries.map((library, index) => (
                <Animated.View key={library.id} entering={listItemEnter(index)}>
                  <IconRow
                    icon="libraries"
                    title={library.name}
                    subtitle={library.role || 'Administrator access'}
                    onPress={() => router.push(`/library/${library.id}`)}
                  />
                </Animated.View>
              ))}
            </View>
          ) : (
            <EmptyState title="No library memberships">
              Ask a library owner to add this account.
            </EmptyState>
          )}
        </Section>
      </View>
    </Page>
  );
}

function ActivityStat({ label, seconds }: { label: string; seconds: number }) {
  return (
    <View>
      <Text className="text-2xl font-bold text-ink">{formatDuration(seconds)}</Text>
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}
