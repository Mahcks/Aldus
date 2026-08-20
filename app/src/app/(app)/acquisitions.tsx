import type {
  AcquisitionRequest,
  AcquisitionSettings,
  Library,
  AcquisitionConnectionStatus,
  TitleRequest,
  User,
} from '../../generated/api';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  acquisitionDate,
  acquisitionFulfillment,
  acquisitionSize,
} from '../../features/acquisition';
import { titleRequestDetail, titleRequestPresentation } from '../../features/title-search';
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
} from '../../features/ui';
import { Text, View } from '../../features/tw';
import { api, errorMessage } from '../../lib/api';

export default function AcquisitionsAdministration() {
  const auth = useAuth();
  const wide = useWindowDimensions().width >= 1100;
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryID, setLibraryID] = useState('');
  const [requests, setRequests] = useState<AcquisitionRequest[]>([]);
  const [titleRequests, setTitleRequests] = useState<TitleRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(true);
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
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingSettings, setTestingSettings] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<AcquisitionConnectionStatus | null>(
    null,
  );
  const [indexerKind, setIndexerKind] = useState<'prowlarr' | 'torznab'>('prowlarr');
  const hasActiveDownloads = requests.some((request) => request.download_state === 'downloading');
  const visibleRequests = requests.filter((request) => acquisitionFulfillment(request));
  const reloadApprovals = useCallback(async () => {
    const values = await Promise.all(libraries.map((library) => api.titleRequests(library.id)));
    setTitleRequests(values.flat());
  }, [libraries]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.libraries(), api.acquisitionSettings(), api.users()])
      .then(async ([available, configured, availableUsers]) => {
        const pending = await Promise.all(
          available.map((library) => api.titleRequests(library.id)),
        );
        if (!active) return;
        setLibraries(available);
        setUsers(availableUsers);
        setTitleRequests(pending.flat());
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
          setApprovalLoading(false);
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

  async function saveSettings() {
    if (savingSettings) return;
    setSavingSettings(true);
    setError('');
    setSuccess('');
    try {
      const configured = await api.updateAcquisitionSettings({
        indexer_url: indexerURL.trim(),
        indexer_kind: indexerKind,
        indexer_api_key: indexerAPIKey.trim(),
        qbittorrent_url: qBitTorrentURL.trim(),
        qbittorrent_username: qBitTorrentUsername.trim(),
        qbittorrent_password: qBitTorrentPassword,
        qbittorrent_category: qBitTorrentCategory.trim() || 'aldus',
        qbittorrent_download_root: qBitTorrentDownloadRoot.trim(),
      });
      setSettings(configured);
      setIndexerAPIKey('');
      setQBitTorrentPassword('');
      setConnectionStatus(await api.testAcquisitionSettings());
      setSuccess('Acquisition settings saved and tested.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingSettings(false);
    }
  }

  async function testSettings() {
    if (testingSettings) return;
    setTestingSettings(true);
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

  const requestHistory = [...titleRequests].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );

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

      <Notice tone="info">
        Readers find and add books from Search. This page is for configuring connections and
        monitoring acquisition activity.
      </Notice>

      <Section title="Requests">
        {approvalError ? <Notice tone="danger">{approvalError}</Notice> : null}
        {approvalSuccess ? <Notice tone="success">{approvalSuccess}</Notice> : null}
        {approvalLoading ? (
          <LoadingState label="Loading requests…" />
        ) : requestHistory.length === 0 ? (
          <EmptyState icon="acquire" title="No requests yet">
            Ebook and audiobook requests made from Search will appear here.
          </EmptyState>
        ) : (
          <View accessibilityRole="list" className="border-t border-line">
            {requestHistory.map((request) => (
              <View key={request.id} className="gap-3 border-b border-line py-4">
                <View className="gap-1">
                  <Text className="font-editorial text-lg font-bold text-ink">{request.title}</Text>
                  <Text className="text-sm text-muted">
                    {[
                      request.author,
                      `Requested by ${requesterName(request.requested_by)}`,
                      acquisitionDate(request.created_at),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {request.formats.map((format) => {
                  const key = `${request.id}:${format.format}`;
                  const status = titleRequestPresentation(format.state) ?? {
                    label: 'Requested',
                    tone: 'info' as const,
                  };
                  return (
                    <View
                      key={format.format}
                      className="min-h-11 gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <View className="min-w-0 flex-1 gap-1">
                        <View className="flex-row items-center gap-3">
                          <Text className="w-24 text-sm font-bold text-ink">
                            {formatLabel(format.format)}
                          </Text>
                          <StatusBadge tone={status.tone} label={status.label} />
                        </View>
                        <Text className="text-sm leading-5 text-muted">
                          {titleRequestDetail(format)}
                        </Text>
                      </View>
                      {format.state === 'pending_approval' ? (
                        <View className="flex-row gap-2">
                          <Button
                            label="Approve"
                            kind="primary"
                            loading={approvalBusy === key}
                            disabled={Boolean(approvalBusy)}
                            onPress={() => void approve(request, format.format)}
                          />
                          <Button
                            label="Deny"
                            kind="quiet"
                            disabled={Boolean(approvalBusy)}
                            onPress={() => setDenyTarget({ request, format: format.format })}
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </Section>

      <View className={wide ? 'flex-row items-start gap-8' : 'gap-8'}>
        <View className={wide ? 'w-[640px]' : undefined}>
          <Section title="Connections">
            <View className="max-w-[720px] gap-4">
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
              {connectionStatus ? (
                <View className="gap-2 border-t border-line pt-4 sm:flex-row">
                  <StatusBadge
                    tone={connectionStatus.prowlarr_ok ? 'success' : 'danger'}
                    label={
                      connectionStatus.prowlarr_ok
                        ? `${connectionStatus.indexer_count} enabled torrent indexer${connectionStatus.indexer_count === 1 ? '' : 's'} found`
                        : 'Search provider unavailable'
                    }
                  />
                  <StatusBadge
                    tone={connectionStatus.qbittorrent_ok ? 'success' : 'danger'}
                    label={
                      connectionStatus.qbittorrent_ok
                        ? 'qBittorrent connected'
                        : 'qBittorrent unavailable'
                    }
                  />
                </View>
              ) : null}
              {connectionStatus?.prowlarr_error ? (
                <Notice tone="danger">{connectionStatus.prowlarr_error}</Notice>
              ) : null}
              {connectionStatus?.qbittorrent_error ? (
                <Notice tone="danger">{connectionStatus.qbittorrent_error}</Notice>
              ) : null}
            </View>
          </Section>
        </View>

        <View className="min-w-0 flex-1 gap-8">
          <Section
            title="Downloads"
            action={
              <Button
                label="Find books in Search"
                icon="search"
                kind="secondary"
                onPress={() => router.push('/search')}
              />
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

              {visibleRequests.length === 0 ? (
                <View className="border-y border-line py-6">
                  <Text className="text-base font-bold text-ink">No downloads yet</Text>
                  <Text className="mt-1 text-sm leading-5 text-muted">
                    A request appears here after Aldus finds a matching release and sends it to
                    qBittorrent.
                  </Text>
                </View>
              ) : (
                <View className="border-t border-line">
                  {visibleRequests.map((request) => {
                    const status = acquisitionFulfillment(request);
                    if (!status) return null;
                    return (
                      <View
                        key={request.id}
                        className="min-h-[72px] gap-2 border-b border-line py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <View className="min-w-0 flex-1 gap-1.5">
                          <Text className="text-sm font-bold text-ink">
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
                            <Text className="text-sm leading-5 text-danger">
                              {request.download_error}
                            </Text>
                          ) : null}
                        </View>
                        <StatusBadge tone={status.tone} label={status.label} />
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
      </View>
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
