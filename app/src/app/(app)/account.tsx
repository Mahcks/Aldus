import type { Library, ReaderCredential, WorkSummary } from '../../generated/api';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '../../features/auth/AuthProvider';
import { useServer } from '../../features/auth/ServerProvider';
import { LibraryCard } from '../../features/bookshelf';
import { formatDuration } from '../../features/format';
import { AppIcon } from '../../features/icons';
import { listItemEnter } from '../../features/motion';
import { Text, View } from '../../features/tw';
import {
  Button,
  colors,
  ConfirmDialog,
  EmptyState,
  Field,
  IconRow,
  Loading,
  Notice,
  Page,
  Section,
  StatusBadge,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';
import { apiBaseURL } from '../../lib/api-base';

const supportURL = 'https://aldus.media/support/';
const privacyURL = 'https://aldus.media/privacy/';

export default function AccountScreen() {
  const auth = useAuth();
  const server = useServer();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [activity, setActivity] = useState<WorkSummary[]>([]);
  const [credentials, setCredentials] = useState<ReaderCredential[]>([]);
  const [credentialLabel, setCredentialLabel] = useState('My KOReader');
  const [createdCredential, setCreatedCredential] = useState<ReaderCredential>();
  const [deletingCredential, setDeletingCredential] = useState<ReaderCredential>();
  const [savingCredential, setSavingCredential] = useState(false);
  const [serverOrigin, setServerOrigin] = useState(apiBaseURL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingAccountDeletion, setConfirmingAccountDeletion] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    let canceled = false;
    Promise.all([
      api.libraries(),
      api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 100 }),
      api.readerCredentials(),
    ])
      .then(([items, works, readerCredentials]) => {
        if (!canceled) {
          setLibraries(items);
          setActivity(works.items);
          setCredentials(readerCredentials);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!serverOrigin && typeof window !== 'undefined') setServerOrigin(window.location.origin);
  }, [serverOrigin]);

  async function signOut() {
    await auth.signOut();
    router.replace('/');
  }

  async function createCredential() {
    if (!credentialLabel.trim()) return;
    setSavingCredential(true);
    setError('');
    try {
      const created = await api.createReaderCredential({ label: credentialLabel.trim() });
      setCredentials((current) => [created, ...current]);
      setCreatedCredential(created);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCredential(false);
    }
  }

  async function deleteCredential() {
    if (!deletingCredential) return;
    setSavingCredential(true);
    try {
      await api.deleteReaderCredential(deletingCredential.id);
      setCredentials((current) => current.filter((item) => item.id !== deletingCredential.id));
      setDeletingCredential(undefined);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCredential(false);
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    setError('');
    try {
      await auth.deleteAccount();
      router.replace('/connect');
    } catch (value) {
      setError(errorMessage(value));
      setConfirmingAccountDeletion(false);
    } finally {
      setDeletingAccount(false);
    }
  }

  async function openExternalURL(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setError('Unable to open that page. Email support@aldus.media for help.');
    }
  }

  const readingSeconds = activity.reduce((total, work) => total + work.reading_seconds, 0);
  const listeningSeconds = activity.reduce((total, work) => total + work.listening_seconds, 0);
  const opdsURL = serverOrigin ? `${serverOrigin}/opds/` : '/opds/';
  const nativeBuild =
    Platform.OS === 'ios'
      ? Constants.platform?.ios?.buildNumber
      : Constants.platform?.android?.versionCode;
  const version = `Version ${Constants.expoConfig?.version ?? 'development'}${nativeBuild ? ` (${nativeBuild})` : ''}`;

  return (
    <Page title="Account" actions={<Button label="Sign out" kind="secondary" onPress={signOut} />}>
      {error ? <Notice danger>{error}</Notice> : null}
      {Platform.OS !== 'web' ? (
        <Section title="Server">
          <View className="gap-2 border-y border-line py-4">
            <Text className="font-sans-semibold text-ink">
              {server.origin.replace(/^https?:\/\//, '')}
            </Text>
            <Text className="text-sm leading-5 text-muted">
              Offline books and reading progress stay separate for each connected server.
            </Text>
            <View className="items-start">
              <Button
                label="Switch server"
                icon="system"
                kind="secondary"
                onPress={() => router.push('/connect')}
              />
            </View>
          </View>
        </Section>
      ) : null}
      <View className="max-w-[680px] gap-8">
        <Section title="Profile">
          <View className="gap-3 border-b border-line pb-5">
            <View className="flex-row items-center gap-4">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <AppIcon name="account" size={26} color={colors.accent} />
              </View>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-lg font-sans-bold text-ink">
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
                  <Text className="text-2xl font-sans-bold text-ink">{activity.length}</Text>
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
            <View className="flex-row flex-wrap gap-3">
              {libraries.map((library, index) => (
                <Animated.View key={library.id} entering={listItemEnter(index)}>
                  <LibraryCard
                    name={library.name}
                    role={library.role}
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
        <Section title="KOReader and OPDS">
          <View className="gap-5">
            <Notice>
              Create a reader credential for each device. It gives that device access only to your
              libraries and reading progress.
            </Notice>
            <View className="gap-3 border-b border-line pb-5">
              <Field
                label="Device name"
                value={credentialLabel}
                onChangeText={setCredentialLabel}
                placeholder="My Kobo"
                help="Use a name you will recognize when revoking access later."
              />
              <View className="flex-row">
                <Button
                  label="Create reader credential"
                  icon="add"
                  loading={savingCredential}
                  disabled={!credentialLabel.trim() || credentials.length >= 10}
                  onPress={() => void createCredential()}
                />
              </View>
              {credentials.length >= 10 ? (
                <Notice tone="warning">Revoke an old credential before creating another.</Notice>
              ) : null}
            </View>
            {createdCredential?.secret ? (
              <View className="gap-3 border-b border-line pb-5">
                <Notice tone="success">
                  Credential created. Save this password now; Aldus will not show it again.
                </Notice>
                <CredentialValue label="Username" value={auth.user?.username || ''} />
                <CredentialValue label="Password" value={createdCredential.secret} />
                <CredentialValue label="OPDS catalog" value={opdsURL} />
                <CredentialValue label="KOReader sync server" value={serverOrigin} />
                <View className="flex-row">
                  <Button
                    label="I saved it"
                    kind="secondary"
                    onPress={() => setCreatedCredential(undefined)}
                  />
                </View>
              </View>
            ) : null}
            {credentials.length ? (
              <View className="gap-3">
                {credentials.map((credential) => (
                  <View
                    key={credential.id}
                    className="min-h-14 flex-row items-center gap-4 border-b border-line py-3"
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-sans-bold text-ink">{credential.label}</Text>
                      <Text className="text-sm text-muted">
                        {credential.last_used_at
                          ? `Last used ${new Date(credential.last_used_at).toLocaleDateString()}`
                          : 'Not used yet'}
                      </Text>
                    </View>
                    <Button
                      label="Revoke"
                      kind="quiet"
                      onPress={() => setDeletingCredential(credential)}
                    />
                  </View>
                ))}
              </View>
            ) : loading ? (
              <Loading label="Loading reader credentials…" />
            ) : (
              <EmptyState icon="devices" title="No reader devices connected">
                Create a credential to connect KOReader or an OPDS reader.
              </EmptyState>
            )}
          </View>
        </Section>
        <Section title="Help and legal">
          <View className="gap-3">
            <IconRow
              icon="support"
              title="Support"
              subtitle="Setup help, troubleshooting, and contact information"
              onPress={() => void openExternalURL(supportURL)}
            />
            <IconRow
              icon="privacy"
              title="Privacy policy"
              subtitle="What stays on your device and what a server operator can access"
              onPress={() => void openExternalURL(privacyURL)}
            />
            <View className="gap-1 border-t border-line pt-4">
              <Text className="text-sm font-sans-semibold text-ink">{version}</Text>
              <Text className="text-sm leading-5 text-muted">
                Aldus does not send diagnostics automatically. You choose what to share with
                support.
              </Text>
            </View>
          </View>
        </Section>
        <Section title="Delete account">
          <View className="items-start gap-4 border-y border-line py-5">
            <Notice danger>
              This permanently removes your account, reading activity, preferences, credentials,
              collections, and offline data from this device. Shared books, server media, and
              anonymized request history remain.
            </Notice>
            <Button
              label="Delete account"
              kind="danger"
              onPress={() => setConfirmingAccountDeletion(true)}
            />
          </View>
        </Section>
      </View>
      <ConfirmDialog
        visible={confirmingAccountDeletion}
        title="Permanently delete your account?"
        description="This cannot be undone. Your account and personal reading data will be removed from this server, along with offline data stored on this device."
        confirmLabel="Delete account"
        danger
        busy={deletingAccount}
        onClose={() => setConfirmingAccountDeletion(false)}
        onConfirm={() => void deleteAccount()}
      />
      <ConfirmDialog
        visible={Boolean(deletingCredential)}
        title="Revoke reader credential?"
        description={`“${deletingCredential?.label || 'This device'}” will immediately lose OPDS and progress-sync access.`}
        confirmLabel="Revoke"
        danger
        busy={savingCredential}
        onClose={() => setDeletingCredential(undefined)}
        onConfirm={() => void deleteCredential()}
      />
    </Page>
  );
}

function CredentialValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      <Text
        selectable
        className="rounded-control border border-line bg-panel px-3 py-2 text-sm text-ink"
      >
        {value}
      </Text>
    </View>
  );
}

function ActivityStat({ label, seconds }: { label: string; seconds: number }) {
  return (
    <View>
      <Text className="text-2xl font-sans-bold text-ink">{formatDuration(seconds)}</Text>
      <Text className="text-xs text-muted">{label}</Text>
    </View>
  );
}
