import { ConnectionSection, ConnectionEditor } from '@/features/acquisitions/ConnectionSection';
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
  const [settingsAction, setSettingsAction] = useState<'connections' | 'trending'>('connections');
  const [settings, setSettings] = useState<AcquisitionSettings | null>(null);
  const [indexerURL, setIndexerURL] = useState('');
  const [indexerAPIKey, setIndexerAPIKey] = useState('');
  const [qBitTorrentURL, setQBitTorrentURL] = useState('');
  const [qBitTorrentUsername, setQBitTorrentUsername] = useState('');
  const [qBitTorrentPassword, setQBitTorrentPassword] = useState('');
  const [qBitTorrentCategory, setQBitTorrentCategory] = useState('aldus');
  const [qBitTorrentDownloadRoot, setQBitTorrentDownloadRoot] = useState('');
  const [sabURL, setSabURL] = useState('');
  const [sabKey, setSabKey] = useState('');
  const [sabCategory, setSabCategory] = useState('');
  const [sabRoot, setSabRoot] = useState('');
  const [nytAPIKey, setNYTAPIKey] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingSettings, setTestingSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<AcquisitionConnectionStatus | null>(
    null,
  );
  const [indexerKind, setIndexerKind] = useState<'prowlarr' | 'torznab' | 'newznab'>('prowlarr');
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
        setSabURL(configured.sabnzbd_url ?? '');
        setSabCategory(configured.sabnzbd_category ?? '');
        setSabRoot(configured.sabnzbd_download_root ?? '');
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

  const connectionsDirty =
    !settings ||
    Boolean(indexerAPIKey || qBitTorrentPassword || sabKey) ||
    indexerKind !== settings.indexer_kind ||
    indexerURL.trim() !== (settings.indexer_url || '') ||
    qBitTorrentURL.trim() !== (settings.qbittorrent_url || '') ||
    qBitTorrentUsername.trim() !== (settings.qbittorrent_username || '') ||
    (qBitTorrentCategory.trim() || 'aldus') !== (settings.qbittorrent_category || 'aldus') ||
    qBitTorrentDownloadRoot.trim() !== (settings.qbittorrent_download_root || '') ||
    sabURL.trim() !== (settings.sabnzbd_url || '') ||
    sabCategory.trim() !== (settings.sabnzbd_category || '') ||
    sabRoot.trim() !== (settings.sabnzbd_download_root || '');

  async function saveSettings(testConnections = true) {
    if (savingSettings || testingSettings || (!testConnections && !settings)) return;
    setSettingsAction(testConnections ? 'connections' : 'trending');
    setSavingSettings(true);
    setError('');
    setSuccess('');
    if (testConnections) setConnectionStatus(null);
    try {
      // The trending action preserves saved connections, including any stored secrets.
      const connections = testConnections
        ? {
            sabnzbd_url: sabURL.trim(),
            sabnzbd_api_key: sabKey.trim(),
            sabnzbd_category: sabCategory.trim(),
            sabnzbd_download_root: sabRoot.trim(),
            indexer_url: indexerURL.trim(),
            indexer_kind: indexerKind,
            indexer_api_key: indexerAPIKey.trim(),
            qbittorrent_url: qBitTorrentURL.trim(),
            qbittorrent_username: qBitTorrentUsername.trim(),
            qbittorrent_password: qBitTorrentPassword,
            qbittorrent_category: qBitTorrentCategory.trim() || 'aldus',
            qbittorrent_download_root: qBitTorrentDownloadRoot.trim(),
          }
        : {
            indexer_api_key: '',
            qbittorrent_password: '',
            sabnzbd_url: settings!.sabnzbd_url || '',
            sabnzbd_category: settings!.sabnzbd_category || '',
            sabnzbd_download_root: settings!.sabnzbd_download_root || '',
            indexer_url: settings!.indexer_url,
            indexer_kind: settings!.indexer_kind,
            qbittorrent_url: settings!.qbittorrent_url,
            qbittorrent_username: settings!.qbittorrent_username,
            qbittorrent_category: settings!.qbittorrent_category,
            qbittorrent_download_root: settings!.qbittorrent_download_root,
          };
      const configured = await api.updateAcquisitionSettings({
        ...connections,
        nyt_api_key: testConnections ? '' : nytAPIKey.trim(),
      });
      setSettings(configured);
      if (testConnections) {
        setIndexerAPIKey('');
        setQBitTorrentPassword('');
        setSabKey('');
        setSuccess('Connections saved.');
        try {
          setConnectionStatus(await api.testAcquisitionSettings());
        } catch (value) {
          setError(
            `Connections were saved, but the check could not finish. ${errorMessage(value)}`,
          );
        }
      } else {
        setNYTAPIKey('');
        setSuccess('Trending settings saved.');
      }
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingSettings(false);
    }
  }

  async function testSettings() {
    if (testingSettings || savingSettings || connectionsDirty) return;
    setSettingsAction('connections');
    setTestingSettings(true);
    setConnectionStatus(null);
    setError('');
    setSuccess('');
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
      {error && tab !== 'settings' ? <Notice tone="danger">{error}</Notice> : null}
      {success && tab !== 'settings' ? <Notice tone="success">{success}</Notice> : null}

      <View accessibilityRole="tablist" className="flex-row border-b border-line">
        {(['requests', 'downloads', 'settings'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            className={`min-h-11 min-w-0 flex-1 items-center justify-center border-b-2 px-2 sm:flex-none sm:px-4 ${
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
        <View className="w-full max-w-[1080px]">
          <Text className="mb-6 max-w-[680px] text-base leading-7 text-muted">
            Connect a search provider and a download client. Aldus finds releases, waits for
            downloads to finish, then imports the books into your library.
          </Text>
          <ConnectionSection
            title="Find releases"
            description="Prowlarr searches your connected indexers. Choose a direct feed only if you already have its Torznab or Newznab address."
          >
            <Select
              label="Search provider"
              value={indexerKind}
              options={[
                { value: 'prowlarr', label: 'Prowlarr' },
                { value: 'torznab', label: 'Direct Torznab feed (advanced)' },
                { value: 'newznab', label: 'Direct Newznab feed (Usenet)' },
              ]}
              onChange={(value) => setIndexerKind(value as 'prowlarr' | 'torznab' | 'newznab')}
            />
            <Field
              label={
                indexerKind === 'prowlarr'
                  ? 'Prowlarr URL'
                  : indexerKind === 'newznab'
                    ? 'Newznab feed URL'
                    : 'Torznab feed URL'
              }
              value={indexerURL}
              onChangeText={setIndexerURL}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={
                indexerKind === 'prowlarr' ? 'http://prowlarr:9696' : 'https://indexer.example/api'
              }
              help={
                indexerKind === 'prowlarr'
                  ? 'Aldus discovers and searches all enabled Prowlarr indexers.'
                  : indexerKind === 'newznab'
                    ? 'Use the API feed address from your Usenet indexer.'
                    : 'Use the Torznab API feed address from your torrent indexer.'
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
          </ConnectionSection>
          <ConnectionSection
            title="Download files"
            description="Use qBittorrent for torrents, SABnzbd for Usenet, or both. You only need to configure the services you use."
          >
            <ConnectionEditor
              name="qBittorrent"
              description="Torrents · keeps your original files for seeding"
              configured={Boolean(settings?.qbittorrent_url)}
            >
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
                <View className="sm:flex-1">
                  <Field
                    label="qBittorrent username"
                    value={qBitTorrentUsername}
                    onChangeText={setQBitTorrentUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View className="sm:flex-1">
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
            </ConnectionEditor>
            <View className="border-t border-line-subtle" />
            <ConnectionEditor
              name="SABnzbd"
              description="Usenet · repairs and unpacks before importing"
              configured={Boolean(settings?.sabnzbd_url)}
            >
              <Field
                label="SABnzbd URL"
                value={sabURL}
                onChangeText={setSabURL}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://sabnzbd:8080"
              />
              <Field
                label="SABnzbd API key"
                value={sabKey}
                onChangeText={setSabKey}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={settings?.has_sabnzbd_api_key ? 'Saved, leave blank to keep it' : ''}
                help="Use the full API key from SABnzbd Settings → General, not the NZB-only key."
              />
              <Field
                label="SABnzbd category"
                value={sabCategory}
                onChangeText={setSabCategory}
                autoCapitalize="none"
                autoCorrect={false}
                help="Use an existing category, or leave blank for SABnzbd's default."
              />
              <Field
                label="SABnzbd completed download root"
                value={sabRoot}
                onChangeText={setSabRoot}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="/downloads"
                help="The completed folder reported by SABnzbd. Mount the same files into Aldus's download folder. Aldus waits for repair and unpacking to finish."
              />
            </ConnectionEditor>
          </ConnectionSection>
          <ConnectionSection
            title="Check your setup"
            description="Save your changes to test the provider and clients together. A connection can work even when Aldus cannot yet see completed files."
          >
            <ConnectionEditor
              help
              name="Connection help"
              description="Addresses, Docker networking, and shared folders"
              configured={false}
            >
              <Text className="text-sm leading-6 text-muted">
                Use an address reachable from the Aldus server. In Docker, localhost points to the
                Aldus container itself. Use a service name on the same Docker network, or your
                server’s LAN address and published port.
              </Text>
              <Text className="text-sm leading-6 text-muted">
                Both apps must see the same completed files. For example, mount the host’s completed
                folder at /downloads in both containers, then enter /downloads as the client
                download root. If the client reports a different path, enter that path instead.
              </Text>
              <Text className="text-sm leading-6 text-muted">
                If the test cannot verify file access yet, finish a download and test again. Aldus
                makes its own library copy and keeps the downloader’s original files.
              </Text>
            </ConnectionEditor>
            <View className="items-start">
              <View className="gap-3 sm:flex-row">
                <Button
                  label="Save connections"
                  icon="check"
                  kind="primary"
                  loading={savingSettings}
                  disabled={
                    testingSettings ||
                    !indexerURL.trim() ||
                    (!qBitTorrentURL.trim() && !sabURL.trim())
                  }
                  onPress={() => void saveSettings()}
                />
                <Button
                  label="Test connections"
                  icon="synced"
                  kind="secondary"
                  loading={testingSettings}
                  disabled={!settings || savingSettings || connectionsDirty}
                  onPress={() => void testSettings()}
                />
              </View>
              {!indexerURL.trim() || (!qBitTorrentURL.trim() && !sabURL.trim()) ? (
                <Text className="mt-2 text-sm text-warning">
                  Add a search provider and at least one download client before saving.
                </Text>
              ) : null}
            </View>
            <Text className="text-sm text-muted">
              {connectionsDirty
                ? 'Save your connection changes before testing. Trending settings are saved separately.'
                : 'Test connections checks your saved settings without changing them.'}
            </Text>
            {settingsAction === 'connections' && error ? (
              <Notice tone="danger">{error}</Notice>
            ) : null}
            {settingsAction === 'connections' && success ? (
              <Notice tone="success">{success}</Notice>
            ) : null}
            {connectionStatus && !connectionsDirty ? (
              <ConnectionDiagnostics status={connectionStatus} />
            ) : null}
          </ConnectionSection>

          <ConnectionSection
            title="Trending books"
            description="Optional discovery lists. Open Library works without an API key; add an NYT key for Best Sellers."
          >
            <View className="max-w-[720px] gap-4">
              <Notice>
                Get an API key at developer.nytimes.com and enable the Books API for your
                application.
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
                  disabled={testingSettings || !settings}
                  icon="check"
                  kind="primary"
                  loading={savingSettings}
                  onPress={() => void saveSettings(false)}
                />
              </View>
              {settingsAction === 'trending' && error ? (
                <Notice tone="danger">{error}</Notice>
              ) : null}
              {settingsAction === 'trending' && success ? (
                <Notice tone="success">{success}</Notice>
              ) : null}
            </View>
          </ConnectionSection>
        </View>
      ) : null}

      {tab === 'downloads' ? (
        <View className="min-w-0 gap-8">
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
                <EmptyState
                  icon="acquire"
                  title={showDownloadHistory ? 'No download history' : 'No active downloads'}
                >
                  New downloads will appear here when a requested release starts downloading.
                </EmptyState>
              ) : (
                <View>
                  {shownDownloads.map((request) => {
                    const status = acquisitionFulfillment(request);
                    if (!status) return null;
                    return (
                      <View
                        key={request.id}
                        className="min-h-[72px] gap-2 border-b border-line py-3 lg:flex-row lg:items-start lg:justify-between"
                      >
                        <View className="min-w-0 gap-1.5 lg:flex-1">
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
                        <View className="items-start gap-2 lg:w-72">
                          <StatusBadge tone={status.tone} label={status.label} />
                          {request.can_cancel ? (
                            <Text className="max-w-[48ch] text-sm text-muted">
                              {request.download_client_kind === 'sabnzbd'
                                ? 'Canceling stops this request and keeps downloaded files in SABnzbd.'
                                : request.torrent_ownership === 'created'
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
