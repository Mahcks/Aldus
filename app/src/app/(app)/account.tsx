import type { Library, ReaderCredential, WorkSummary } from '@/generated/api';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '@/features/auth/AuthProvider';
import { useServer } from '@/features/auth/ServerProvider';
import { LibraryCard } from '@/features/bookshelf';
import { formatDuration } from '@/features/format';
import { AppIcon } from '@/features/icons';
import { listItemEnter } from '@/features/motion';
import { Text, View } from '@/features/tw';
import {
  Button,
  colors,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconRow,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  StatusBadge,
} from '@/features/ui';
import { api, errorMessage } from '@/lib/api';
import { apiBaseURL, isLoopbackURL } from '@/lib/api-base';

const supportURL = 'https://aldus.media/support/';
const privacyURL = 'https://aldus.media/privacy/';
const koreaderURL = 'https://aldus.media/ereaders/koreader/';

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
  const [success, setSuccess] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState(auth.user?.display_name || '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    password: '',
    password_confirmation: '',
  });
  const [savingAccount, setSavingAccount] = useState(false);
  const [confirmingSignOutEverywhere, setConfirmingSignOutEverywhere] = useState(false);
  const [confirmingAccountDeletion, setConfirmingAccountDeletion] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    let canceled = false;
    Promise.allSettled([
      api.libraries(),
      api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 100 }),
      api.readerCredentials(),
    ])
      .then(([libraryResult, activityResult, credentialResult]) => {
        if (canceled) return;
        if (libraryResult.status === 'fulfilled') setLibraries(libraryResult.value);
        if (activityResult.status === 'fulfilled') setActivity(activityResult.value.items);
        if (credentialResult.status === 'fulfilled') setCredentials(credentialResult.value);
        const failed = [libraryResult, activityResult, credentialResult].find(
          (result) => result.status === 'rejected',
        );
        if (failed?.status === 'rejected') setError(errorMessage(failed.reason));
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

  async function saveProfile() {
    if (!displayName.trim()) return;
    setSavingAccount(true);
    setError('');
    try {
      const user = await api.updateProfile({ display_name: displayName.trim() });
      await auth.signedIn(user);
      setEditingProfile(false);
      setSuccess('Profile updated.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingAccount(false);
    }
  }

  async function changePassword() {
    setSavingAccount(true);
    setError('');
    try {
      const user = await api.changePassword(passwordForm);
      await auth.signedIn(user);
      setPasswordForm({ current_password: '', password: '', password_confirmation: '' });
      setChangingPassword(false);
      setSuccess('Password changed. Other app sessions were signed out.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingAccount(false);
    }
  }

  function closePasswordDialog() {
    setPasswordForm({ current_password: '', password: '', password_confirmation: '' });
    setChangingPassword(false);
  }

  function closeProfileDialog() {
    setDisplayName(auth.user?.display_name || '');
    setEditingProfile(false);
  }

  function closeDeletionDialog() {
    setDeletionPassword('');
    setConfirmingAccountDeletion(false);
  }

  async function signOutEverywhere() {
    setSavingAccount(true);
    setError('');
    try {
      await auth.signOutEverywhere();
      router.replace('/login');
    } catch (value) {
      setError(errorMessage(value));
      setConfirmingSignOutEverywhere(false);
    } finally {
      setSavingAccount(false);
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    setError('');
    try {
      await auth.deleteAccount(deletionPassword);
      router.replace('/connect');
    } catch (value) {
      setError(errorMessage(value));
      closeDeletionDialog();
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
  const readerAddressIsLocal = isLoopbackURL(serverOrigin);
  const nativeBuild =
    Platform.OS === 'ios'
      ? Constants.platform?.ios?.buildNumber
      : Constants.platform?.android?.versionCode;
  const version = `Version ${Constants.expoConfig?.version ?? 'development'}${nativeBuild ? ` (${nativeBuild})` : ''}`;
  const isGuest = Boolean(auth.user?.demo_expires_at);
  const passwordsMatch = passwordForm.password === passwordForm.password_confirmation;
  const canChangePassword =
    passwordForm.current_password.length > 0 &&
    passwordForm.password.length >= 12 &&
    passwordsMatch;

  return (
    <Page title="Account" actions={<Button label="Sign out" kind="secondary" onPress={signOut} />}>
      {error ? <Notice danger>{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
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
            {!isGuest ? (
              <Row>
                <Button
                  label="Edit name"
                  kind="secondary"
                  onPress={() => setEditingProfile(true)}
                />
                <Button
                  label="Change password"
                  kind="secondary"
                  onPress={() => setChangingPassword(true)}
                />
              </Row>
            ) : null}
          </View>
        </Section>
        {!isGuest ? (
          <Section title="Security">
            <View className="items-start gap-3 border-y border-line py-5">
              <Text className="text-sm leading-5 text-muted">
                If a phone or browser is lost, sign out every Aldus app session. Your KOReader and
                OPDS credentials stay connected.
              </Text>
              <Button
                label="Sign out everywhere"
                kind="secondary"
                onPress={() => setConfirmingSignOutEverywhere(true)}
              />
            </View>
          </Section>
        ) : null}
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
            {readerAddressIsLocal ? (
              <Notice tone="warning">
                This server address points back to this device. KOReader needs your server&apos;s
                LAN or HTTPS address instead of localhost.
              </Notice>
            ) : null}
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
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="I saved it"
                    kind="secondary"
                    onPress={() => setCreatedCredential(undefined)}
                  />
                  <Button
                    label="KOReader setup guide"
                    kind="quiet"
                    icon="read"
                    onPress={() => void openExternalURL(koreaderURL)}
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
      {isGuest ? (
        <ConfirmDialog
          visible={confirmingAccountDeletion}
          title="Permanently delete your account?"
          description="This cannot be undone. Your guest account and personal reading data will be removed from this server, along with offline data stored on this device."
          confirmLabel="Delete account"
          danger
          busy={deletingAccount}
          onClose={() => setConfirmingAccountDeletion(false)}
          onConfirm={() => void deleteAccount()}
        />
      ) : (
        <Dialog
          visible={confirmingAccountDeletion}
          title="Permanently delete your account?"
          onClose={closeDeletionDialog}
        >
          <View className="gap-5">
            <Notice danger>
              This cannot be undone. Enter your current password to remove your account and personal
              reading data.
            </Notice>
            <Field
              label="Current password"
              secureTextEntry
              autoComplete="current-password"
              value={deletionPassword}
              onChangeText={setDeletionPassword}
            />
            <Row>
              <Button label="Cancel" onPress={closeDeletionDialog} />
              <Button
                label="Delete account"
                kind="danger"
                loading={deletingAccount}
                disabled={!deletionPassword}
                onPress={() => void deleteAccount()}
              />
            </Row>
          </View>
        </Dialog>
      )}
      <Dialog visible={editingProfile} title="Edit profile" onClose={closeProfileDialog}>
        <View className="gap-4">
          <Field label="Display name" value={displayName} onChangeText={setDisplayName} autoFocus />
          <Text className="text-sm text-muted">
            Your username stays fixed after setup so connected e-readers keep working.
          </Text>
          <Row>
            <Button label="Cancel" onPress={closeProfileDialog} />
            <Button
              label="Save name"
              kind="primary"
              loading={savingAccount}
              disabled={!displayName.trim()}
              onPress={() => void saveProfile()}
            />
          </Row>
        </View>
      </Dialog>
      <Dialog visible={changingPassword} title="Change password" onClose={closePasswordDialog}>
        <View className="gap-4">
          <Notice>Changing your password signs out every other Aldus app session.</Notice>
          <Field
            label="Current password"
            secureTextEntry
            autoComplete="current-password"
            value={passwordForm.current_password}
            onChangeText={(current_password) =>
              setPasswordForm((current) => ({ ...current, current_password }))
            }
          />
          <Field
            label="New password"
            secureTextEntry
            autoComplete="new-password"
            value={passwordForm.password}
            onChangeText={(password) => setPasswordForm((current) => ({ ...current, password }))}
            help="Use at least 12 characters."
          />
          <Field
            label="Confirm new password"
            secureTextEntry
            autoComplete="new-password"
            value={passwordForm.password_confirmation}
            onChangeText={(password_confirmation) =>
              setPasswordForm((current) => ({ ...current, password_confirmation }))
            }
            error={
              passwordForm.password_confirmation && !passwordsMatch
                ? 'Passwords do not match.'
                : undefined
            }
          />
          <Row>
            <Button label="Cancel" onPress={closePasswordDialog} />
            <Button
              label="Change password"
              kind="primary"
              loading={savingAccount}
              disabled={!canChangePassword}
              onPress={() => void changePassword()}
            />
          </Row>
        </View>
      </Dialog>
      <ConfirmDialog
        visible={confirmingSignOutEverywhere}
        title="Sign out everywhere?"
        description="Every Aldus app session, including this one, will be signed out. Reader-device credentials are not affected."
        confirmLabel="Sign out everywhere"
        busy={savingAccount}
        onClose={() => setConfirmingSignOutEverywhere(false)}
        onConfirm={() => void signOutEverywhere()}
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
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // The value remains selectable when browser clipboard permission is denied.
    }
  }

  return (
    <View className="gap-1">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Text
          selectable
          className="min-w-0 flex-1 rounded-control border border-line bg-panel px-3 py-2 text-sm text-ink"
        >
          {value}
        </Text>
        {Platform.OS === 'web' ? (
          <Button
            label={copied ? 'Copied' : 'Copy'}
            kind="quiet"
            icon="copy"
            onPress={() => void copyValue()}
          />
        ) : null}
      </View>
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
