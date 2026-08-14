import type { Library } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import { AppIcon } from '../../features/icons';
import { Pressable, Text, View } from '../../features/tw';
import {
  Button,
  colors,
  EmptyState,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;
    api
      .libraries()
      .then((items) => {
        if (!canceled) setLibraries(items);
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

  return (
    <Page title="Account" actions={<Button label="Sign out" kind="secondary" onPress={signOut} />}>
      {error ? <Notice danger>{error}</Notice> : null}
      <View className="max-w-[680px] gap-8">
        <Section title="Profile">
          <View className="flex-row items-center gap-4 border-b border-line pb-5">
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
            {auth.user?.admin ? (
              <StatusBadge tone="info" label="Administrator" icon="users" />
            ) : null}
          </View>
        </Section>
        <Section title="Your libraries">
          {loading ? (
            <Loading label="Loading libraries…" />
          ) : libraries.length ? (
            <View className="gap-1">
              {libraries.map((library) => (
                <Pressable
                  key={library.id}
                  accessibilityRole="link"
                  onPress={() => router.push(`/library/${library.id}`)}
                  className="min-h-14 flex-row items-center justify-between gap-4 border-b border-line py-2 focus:outline focus:outline-2 focus:outline-focus"
                >
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="font-bold text-ink">
                      {library.name}
                    </Text>
                    <Text className="text-xs capitalize text-muted">
                      {library.role || 'Administrator access'}
                    </Text>
                  </View>
                  <AppIcon name="chevron" size={20} color={colors.subtle} />
                </Pressable>
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
