import { ConnectionDiagnostics } from '@/features/acquisitions/SearchDiagnostics';
import { useTitleRequests } from '@/features/use-title-requests';
import type {
  AcquisitionRequest,
  AcquisitionSettings,
  Library,
  AcquisitionConnectionStatus,
  TitleRequest,
  User,
} from '@/generated/api';
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  acquisitionFailureMessage,
  acquisitionDate,
  acquisitionFulfillment,
  acquisitionSize,
} from '@/features/acquisition';
import { RequestStatusFilter } from '@/features/acquisitions/RequestStatusFilter';
import { RequestRow } from '@/features/acquisitions/RequestRow';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Page,
  Section,
  Select,
  StatusBadge,
} from '@/features/ui';
import { Pressable, Text, View } from '@/features/tw';
import { api, errorMessage } from '@/lib/api';

export default function AcquisitionsAdministration() {
  const auth = useAuth();
  const [tab, setTab] = useState<'requests' | 'downloads' | 'settings'>('requests');
  const [requestFilter, setRequestFilter] = useState<
    'all' | 'pending_approval' | 'active' | 'ready' | 'history'
  >('all');
  const [showDownloadHistory, setShowDownloadHistory] = useState(false);
  const [technicalRequestID, setTechnicalRequestID] = useState('');
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryID, setLibraryID] = useState('');
  const [requests, setRequests] = useState<AcquisitionRequest[]>([]);
  const requestPages = useTitleRequests(requestFilter, false);
  const titleRequests = requestPages.items;
  const [users, setUsers] = useState<User[]>([]);
  const approvalLoading = requestPages.loading;
  const [approvalError, setApprovalError] = useState('');
  const [approvalSuccess, setApprovalSuccess] = useState('');
  const [approvalBusy, setApprovalBusy] = useState('');
  const [denyTarget, setDenyTarget] = useState<{ request: TitleRequest; format: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState<AcquisitionSettings | null>(null);
  const [indexerURL, setIndexerURL] = useState('');
  const [indexerAPIKey, setIndexerAPIKey] = useState('');
  const [qBitTorrentURL, setQBitTorrentURL] = useState('');
  const [qBitTorrentUsername, setQBitTorrentUsername] = useState('');
  const [qBitTorrentPassword, setQBitTorrentPassword] = useState('');
  const [qBitTorrentCategory, setQBitTorrentCategory] = useState('aldus');
  const [qBitTorrentDownloadRoot, setQBitTorrentDownloadRoot] = useState('');
  const [nytAPIKey, setNYTAPIKey] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingSettings, setTestingSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<AcquisitionConnectionStatus | null>(
    null,
  );
  const [indexerKind, setIndexerKind] = useState<'prowlarr' | 'torznab'>('prowlarr');
  const hasActiveDownloads = requests.some((request) => request.download_state === 'downloading');
  const visibleRequests = requests.filter((request) => acquisitionFulfillment(request));
  const reloadApprovals = requestPages.refresh;

  useEffect(() => {
    let active = true;
    void Promise.all([api.libraries(), api.acquisitionSettings(), api.users()])
      .then(async ([available, configured, availableUsers]) => {
        if (!active) return;
        setLibraries(available);
        setUsers(availableUsers);
        setLibraryID(available[0]?.id ?? '');
        setSettings(configured);
        setIndexerKind(configured.indexer_kind || 'prowlarr');
        setIndexerURL(configured.indexer_url);
        setQBitTorrentURL(configured.qbittorrent_url);
        setQBitTorrentUsername(configured.qbittorrent_username);
        setQBitTorrentCategory(configured.qbittorrent_category || 'aldus');
        setQBitTorrentDownloadRoot(configured.qbittorrent_download_root);
      })
      .catch((value) => active && setError(errorMessage(value)))
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!libraryID) return;
    let active = true;
    void api
      .acquisitionRequests(libraryID)
      .then((values) => active && setRequests(values))
      .catch((value) => active && setError(errorMessage(value)));
    return () => {
      active = false;
    };
  }, [libraryID]);

  useEffect(() => {
    if (!libraryID || !hasActiveDownloads) return;
    const timer = setInterval(() => {
      void api
        .acquisitionRequests(libraryID)
        .then(setRequests)
        .catch((value) => setError(errorMessage(value)));
    }, 5000);
    return () => clearInterval(timer);
  }, [hasActiveDownloads, libraryID]);

  useEffect(() => {
    if (libraries.length === 0) return;
    const timer = setInterval(() => {
      void reloadApprovals().catch((value) => setApprovalError(errorMessage(value)));
    }, 5000);
    return () => clearInterval(timer);
  }, [libraries, reloadApprovals]);

  async function saveSettings(testConnections = true) {
    if (savingSettings) return;
    setSavingSettings(true);
    setError('');
    setSuccess('');
    try {
      const configured = await api.updateAcquisitionSettings({
        indexer_url: indexerURL.trim(),
        indexer_kind: indexerKind,
        indexer_api_key: indexerAPIKey.trim(),
        nyt_api_key: nytAPIKey.trim(),
        qbittorrent_url: qBitTorrentURL.trim(),
        qbittorrent_username: qBitTorrentUsername.trim(),
        qbittorrent_password: qBitTorrentPassword,
        qbittorrent_category: qBitTorrentCategory.trim() || 'aldus',
        qbittorrent_download_root: qBitTorrentDownloadRoot.trim(),
      });
      setSettings(configured);
      setIndexerAPIKey('');
      setNYTAPIKey('');
      setQBitTorrentPassword('');
      if (testConnections) {
        setConnectionStatus(await api.testAcquisitionSettings());
        setSuccess('Acquisition settings saved and tested.');
      } else {
        setSuccess('Trending settings saved.');
      }
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingSettings(false);
    }
  }

  async function testSettings() {
    if (testingSettings) return;
    setTestingSettings(true);
    setConnectionStatus(null);
    setError('');
    try {
      setConnectionStatus(await api.testAcquisitionSettings());
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setTestingSettings(false);
    }
  }

  async function approve(request: TitleRequest, format: string) {
    const key = `${request.id}:${format}`;
    setApprovalBusy(key);
    setApprovalError('');
    setApprovalSuccess('');
    try {
      await api.approveTitleRequest(request.library_id, request.id, format);
      await reloadApprovals();
      setApprovalSuccess(`${formatLabel(format)} request for ${request.title} approved.`);
    } catch (value) {
      setApprovalError(errorMessage(value));
    } finally {
      setApprovalBusy('');
    }
  }

  async function deny() {
    if (!denyTarget) return;
    const key = `${denyTarget.request.id}:${denyTarget.format}`;
    setApprovalBusy(key);
    setApprovalError('');
    setApprovalSuccess('');
    try {
      await api.denyTitleRequest(
        denyTarget.request.library_id,
        denyTarget.request.id,
        denyTarget.format,
      );
      const title = denyTarget.request.title;
      const format = denyTarget.format;
      setDenyTarget(null);
      await reloadApprovals();
      setApprovalSuccess(`${formatLabel(format)} request for ${title} declined.`);
    } catch (value) {
      setApprovalError(errorMessage(value));
    } finally {
      setApprovalBusy('');
    }
  }

  const shownRequests = [...titleRequests].sort(
    (left, right) =>
      right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id),
  );
  const requestEmptyState = {
    all: {
      title: 'No requests yet',
      detail: 'Books requested in Discover will appear here for you to follow and approve.',
    },
    active: {
      title: 'No active requests',
      detail:
        'Nothing is waiting for approval, searching, or downloading. Choose All requests to see earlier requests.',
    },
    pending_approval: {
      title: 'No approvals waiting',
      detail: 'You’re caught up. Requests that need your permission will appear here.',
    },
    ready: {
      title: 'No ready requests yet',
      detail: 'Fulfilled requests appear here once the books are available in the library.',
    },
    history: {
      title: 'No past attempts',
      detail: 'Canceled, declined, and unsuccessful requests appear here.',
    },
  }[requestFilter];
  const currentDownloads = visibleRequests.filter((request) => {
    const status = acquisitionFulfillment(request);
    return status?.pending || status?.tone === 'danger' || status?.action === 'review';
  });
  const shownDownloads = showDownloadHistory ? visibleRequests : currentDownloads;

  function requesterName(id: string) {
    const user = users.find((candidate) => candidate.id === id);
    return user?.display_name || user?.username || 'Reader';
  }

  if (!auth.user?.admin)
    return (
      <Page title="Acquisitions" editorial={false}>
        <ErrorState title="Administrator access required">
          Only administrators can configure acquisition services and review system activity.
        </ErrorState>
      </Page>
    );

  if (loading)
    return (
      <Page title="Acquisitions" editorial={false}>
        <LoadingState label="Loading acquisition settings…" />
      </Page>
    );

  return (
    <Page title="Acquisitions" editorial={false}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}

      <View accessibilityRole="tablist" className="flex-row border-b border-line">
        {(['requests', 'downloads', 'settings'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            className={`min-h-11 justify-center border-b-2 px-4 ${
              tab === value ? 'border-accent' : 'border-transparent'
            }`}
            onPress={() => setTab(value)}
          >
            <Text
              className={`text-sm font-sans-bold ${tab === value ? 'text-accent' : 'text-muted'}`}
            >
              {value === 'settings' ? 'Connections' : `${value[0].toUpperCase()}${value.slice(1)}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'requests' ? (
        <Section
          title="Book requests"
          action={
            <View className="w-full sm:w-56">
              <RequestStatusFilter
                label="Request status"
                value={requestFilter}
                onChange={(value) => setRequestFilter(value as typeof requestFilter)}
                options={[
                  { value: 'all', label: 'All requests' },
                  { value: 'pending_approval', label: 'Awaiting approval' },
                  { value: 'active', label: 'Active requests' },
                  { value: 'ready', label: 'Ready in library' },
                  { value: 'history', label: 'Past attempts' },
                ]}
              />
            </View>
          }
        >
          <Text className="text-sm leading-5 text-muted">
            Across your libraries, newest requests first.
          </Text>
          {approvalError || requestPages.error ? (
            <Notice tone="danger">{approvalError || requestPages.error}</Notice>
          ) : null}
          {requestPages.error ? (
            <Button
              label="Retry requests"
              kind="secondary"
              onPress={() => void reloadApprovals()}
            />
          ) : null}
          {approvalSuccess ? <Notice tone="success">{approvalSuccess}</Notice> : null}
          {approvalLoading && shownRequests.length === 0 ? (
            <LoadingState label="Loading requests…" />
          ) : shownRequests.length === 0 ? (
            !requestPages.error ? (
              <EmptyState icon="acquire" title={requestEmptyState?.title}>
                {requestEmptyState?.detail}
              </EmptyState>
            ) : null
          ) : (
            <View accessibilityRole="list">
              {shownRequests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  requester={requesterName(request.requested_by)}
                  library={libraries.find((library) => library.id === request.library_id)?.name}
                  busy={approvalBusy}
                  onApprove={(format) => void approve(request, format)}
                  onDeny={(format) => setDenyTarget({ request, format })}
                />
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
      ) : null}

      {tab === 'settings' ? (
        <View className="w-full max-w-[720px] gap-10">
          <Section title="Connections">
            <View className="max-w-[720px] gap-4">
              <Text className="text-base font-sans-semibold text-ink">Find releases</Text>
              <Select
                label="Search provider"
                value={indexerKind}
                options={[
                  { value: 'prowlarr', label: 'Prowlarr' },
                  { value: 'torznab', label: 'Direct Torznab feed (advanced)' },
                ]}
                onChange={(value) => setIndexerKind(value as 'prowlarr' | 'torznab')}
              />
              <Field
                label={indexerKind === 'prowlarr' ? 'Prowlarr URL' : 'Torznab feed URL'}
                value={indexerURL}
                onChangeText={setIndexerURL}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={
                  indexerKind === 'prowlarr'
                    ? 'http://prowlarr:9696'
                    : 'https://indexer.example/api'
                }
                help={
                  indexerKind === 'prowlarr'
                    ? 'Aldus discovers and searches all enabled Prowlarr indexers.'
                    : 'Use an individual torrent indexer feed URL.'
                }
              />
              <Field
                label="Indexer API key"
                value={indexerAPIKey}
                onChangeText={setIndexerAPIKey}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder={settings?.has_indexer_api_key ? 'Saved, leave blank to keep it' : ''}
              />
              <View className="gap-1 border-t border-line-subtle pt-6">
                <Text className="text-base font-sans-semibold text-ink">Download files</Text>
                <Text className="text-sm text-muted">
                  Connect qBittorrent to receive the releases you approve.
                </Text>
              </View>
              <Field
                label="qBittorrent URL"
                value={qBitTorrentURL}
                onChangeText={setQBitTorrentURL}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://qbittorrent:8080"
              />
              <View className="gap-4 sm:flex-row">
                <View className="flex-1">
                  <Field
                    label="qBittorrent username"
                    value={qBitTorrentUsername}
                    onChangeText={setQBitTorrentUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View className="flex-1">
                  <Field
                    label="qBittorrent password"
                    value={qBitTorrentPassword}
                    onChangeText={setQBitTorrentPassword}
                    secureTextEntry
                    placeholder={
                      settings?.has_qbittorrent_password ? 'Saved, leave blank to keep it' : ''
                    }
                  />
                </View>
              </View>
              <Field
                label="qBittorrent category"
                value={qBitTorrentCategory}
                onChangeText={setQBitTorrentCategory}
                autoCapitalize="none"
                autoCorrect={false}
                help="Downloads are grouped under this category."
              />
              <Field
                label="qBittorrent download root"
                value={qBitTorrentDownloadRoot}
                onChangeText={setQBitTorrentDownloadRoot}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="/downloads"
                help="Enter the path qBittorrent reports for completed files. This is not Aldus's /downloads mount unless qBittorrent also reports /downloads."
              />
              <View className="items-start">
                <View className="gap-3 sm:flex-row">
                  <Button
                    label="Save connections"
                    icon="check"
                    kind="primary"
                    loading={savingSettings}
                    disabled={!indexerURL.trim() || !qBitTorrentURL.trim()}
                    onPress={() => void saveSettings()}
                  />
                  <Button
                    label="Test connections"
                    icon="synced"
                    kind="secondary"
                    loading={testingSettings}
                    disabled={!settings || savingSettings}
                    onPress={() => void testSettings()}
                  />
                </View>
                {!indexerURL.trim() || !qBitTorrentURL.trim() ? (
                  <Text className="mt-2 text-sm text-warning">
                    Add both service URLs before saving.
                  </Text>
                ) : null}
              </View>
              {connectionStatus ? <ConnectionDiagnostics status={connectionStatus} /> : null}
            </View>
          </Section>

          <Section title="Trending books">
            <View className="max-w-[720px] gap-4">
              <Notice>
                Optional. Once configured, Discover shows NYT Best Sellers alongside its always-on
                Open Library trending feed. Registering a key is free at developer.nytimes.com.
              </Notice>
              <Field
                label="NYT API key"
                value={nytAPIKey}
                onChangeText={setNYTAPIKey}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder={settings?.has_nyt_api_key ? 'Saved, leave blank to keep it' : ''}
              />
              <View className="items-start">
                <Button
                  label="Save trending settings"
                  icon="check"
                  kind="primary"
                  loading={savingSettings}
                  onPress={() => void saveSettings(false)}
                />
              </View>
            </View>
          </Section>
        </View>
      ) : null}

      {tab === 'downloads' ? (
        <View className="min-w-0 flex-1 gap-8">
          <Section
            title="Downloads"
            action={
              <View className="flex-row gap-2">
                {visibleRequests.length > currentDownloads.length ? (
                  <Button
                    label={showDownloadHistory ? 'Hide history' : 'Show history'}
                    kind="quiet"
                    onPress={() => setShowDownloadHistory((value) => !value)}
                  />
                ) : null}
              </View>
            }
          >
            <View className="gap-4">
              {libraries.length > 1 ? (
                <Select
                  label="Library"
                  value={libraryID}
                  options={libraries.map((library) => ({ value: library.id, label: library.name }))}
                  onChange={setLibraryID}
                />
              ) : libraries[0] ? (
                <Text className="text-sm text-muted">{libraries[0].name}</Text>
              ) : null}

              {shownDownloads.length === 0 ? (
                <EmptyState icon="acquire" title="No active downloads">
                  New downloads will appear here. Open history to review earlier attempts.
                </EmptyState>
              ) : (
                <View>
                  {shownDownloads.map((request) => {
                    const status = acquisitionFulfillment(request);
                    if (!status) return null;
                    return (
                      <View
                        key={request.id}
                        className="min-h-[72px] gap-2 border-b border-line py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <View className="min-w-0 flex-1 gap-1.5">
                          <Text className="text-sm font-sans-bold text-ink">
                            {request.selected_title || request.query}
                          </Text>
                          <Text className="text-xs text-muted">
                            {[
                              request.selected_source,
                              request.selected_size ? acquisitionSize(request.selected_size) : '',
                              acquisitionDate(request.updated_at),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                          {request.download_error ? (
                            <View className="items-start gap-1">
                              <Text className="text-sm leading-5 text-danger">
                                {acquisitionFailureMessage(request)}
                              </Text>
                              <Button
                                label={
                                  technicalRequestID === request.id
                                    ? 'Hide technical details'
                                    : 'Technical details'
                                }
                                kind="quiet"
                                onPress={() =>
                                  setTechnicalRequestID((value) =>
                                    value === request.id ? '' : request.id,
                                  )
                                }
                              />
                              {technicalRequestID === request.id ? (
                                <Text
                                  selectable
                                  className="max-w-[72ch] text-xs leading-5 text-muted"
                                >
                                  {request.download_error}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                        <View className="items-start gap-2">
                          <StatusBadge tone={status.tone} label={status.label} />
                          {request.can_cancel ? (
                            <Text className="max-w-[48ch] text-sm text-muted">
                              {request.torrent_ownership === 'created'
                                ? 'Created by Aldus. Canceling can remove this download and its files.'
                                : 'Canceling this request keeps the torrent and its files in qBittorrent.'}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </Section>

          <Notice tone="info">
            Already use Listenarr or another download manager? Point it at an enabled Aldus Source
            folder. Aldus can scan completed files without a search-provider connection.
          </Notice>
        </View>
      ) : null}
      <ConfirmDialog
        visible={Boolean(denyTarget)}
        title={`Deny ${denyTarget ? formatLabel(denyTarget.format).toLowerCase() : ''} request?`}
        description="The reader will be notified. They can request this format again later."
        confirmLabel="Deny request"
        busy={Boolean(denyTarget && approvalBusy)}
        danger
        onConfirm={() => void deny()}
        onClose={() => setDenyTarget(null)}
      />
    </Page>
  );
}

function formatLabel(format: string) {
  return format === 'audiobook' ? 'Audiobook' : 'Ebook';
}
