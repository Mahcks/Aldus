import type { BackupArchive, SystemDiagnostics } from '@/generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { AppIcon, type AppIconName } from '@/features/icons';
import { colors } from '@/features/theme';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  Notice,
  Page,
  Section,
} from '@/features/ui';
import { Text, View } from '@/features/tw';
import { api, errorMessage } from '@/lib/api';
import { formatBytes } from '@/features/system-presentation';

export default function SystemAdministration() {
  const auth = useAuth();
  const [report, setReport] = useState<SystemDiagnostics>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backups, setBackups] = useState<BackupArchive[]>([]);
  const [backupError, setBackupError] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupArchive>();

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [nextReport, nextBackups] = await Promise.all([api.systemDiagnostics(), api.backups()]);
      setReport(nextReport);
      setBackups(nextBackups);
      setBackupError('');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
      setBackupsLoading(false);
    }
  }

  async function createBackup() {
    setCreatingBackup(true);
    setBackupError('');
    setBackupMessage('');
    try {
      const archive = await api.createBackup();
      setBackups((current) => [archive, ...current]);
      setBackupMessage('Backup created and verified.');
    } catch (value) {
      setBackupError(errorMessage(value));
    } finally {
      setCreatingBackup(false);
    }
  }

  async function downloadBackup(archive: BackupArchive) {
    setBackupError('');
    try {
      saveBlob(await api.downloadBackup(archive.name), archive.name);
    } catch (value) {
      setBackupError(errorMessage(value));
    }
  }

  async function deleteBackup() {
    if (!deleteTarget) return;
    setDeletingBackup(true);
    setBackupError('');
    try {
      await api.deleteBackup(deleteTarget.name);
      setBackups((current) => current.filter((archive) => archive.name !== deleteTarget.name));
      setDeleteTarget(undefined);
    } catch (value) {
      setBackupError(errorMessage(value));
    } finally {
      setDeletingBackup(false);
    }
  }

  function downloadDiagnostics() {
    if (!report || Platform.OS !== 'web') return;
    const date = new Date().toISOString().slice(0, 10);
    saveBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      `aldus-diagnostics-${date}.json`,
    );
  }

  useEffect(() => {
    let active = true;
    void api
      .systemDiagnostics()
      .then((value) => active && setReport(value))
      .catch((value) => active && setError(errorMessage(value)))
      .finally(() => active && setLoading(false));
    void api
      .backups()
      .then((value) => active && setBackups(value))
      .catch((value) => active && setBackupError(errorMessage(value)))
      .finally(() => active && setBackupsLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (!auth.user?.admin)
    return (
      <Page title="System" editorial={false}>
        <ErrorState title="Administrator access required">
          Only administrators can view server diagnostics.
        </ErrorState>
      </Page>
    );

  if (loading && !report)
    return (
      <Page title="System" editorial={false}>
        <LoadingState label="Checking Aldus…" />
      </Page>
    );

  if (!report)
    return (
      <Page title="System" editorial={false}>
        <ErrorState
          title="Diagnostics unavailable"
          action={<Button label="Try again" onPress={refresh} />}
        >
          {error}
        </ErrorState>
      </Page>
    );

  const sourcesHealthy = report.source_roots_configured === report.source_roots_reachable;
  const queuesHealthy = report.failed_source_scans === 0 && report.failed_alignment_jobs === 0;

  return (
    <Page
      title="System"
      editorial={false}
      actions={
        <Button
          label={loading ? 'Checking…' : 'Check again'}
          icon="scan"
          disabled={loading}
          onPress={refresh}
        />
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Notice tone="info">
        This page reports Aldus itself. Source and acquisition connection tests remain in their
        administration pages.
      </Notice>

      <View className="max-w-[760px] gap-10">
        <Section title="Core services">
          <DiagnosticRow
            label="Database"
            detail={`Schema ${report.schema_version}`}
            healthy={report.database_status === 'ok'}
          />
          <DiagnosticRow
            label="Managed storage"
            detail="Aldus can write its data directory"
            healthy={report.storage_status === 'ok'}
          />
          <View className="flex-row flex-wrap gap-x-8 gap-y-2 pt-1">
            <Meta label="Version" value={report.version} />
            <Meta label="Environment" value={report.environment} />
          </View>
          {Platform.OS === 'web' ? (
            <View className="flex-row pt-1">
              <Button
                label="Download diagnostic report"
                icon="report"
                kind="secondary"
                onPress={downloadDiagnostics}
              />
            </View>
          ) : (
            <Text className="text-sm leading-6 text-muted">
              Open this page in a web browser to download a diagnostic report. Aldus never sends it
              automatically.
            </Text>
          )}
        </Section>

        <Section
          title="Library operations"
          action={
            <Button label="Open Sources" kind="quiet" onPress={() => router.push('/sources')} />
          }
        >
          <DiagnosticRow
            label="Source folders"
            detail={`${report.source_roots_reachable} of ${report.source_roots_configured} reachable`}
            healthy={sourcesHealthy}
          />
          <DiagnosticRow
            label="Source scans"
            detail={`${report.pending_source_scans} active · ${report.failed_source_scans} failed`}
            healthy={report.failed_source_scans === 0}
          />
          <DiagnosticRow
            label="Alignment jobs"
            detail={`${report.pending_alignment_jobs} active · ${report.failed_alignment_jobs} failed`}
            healthy={report.failed_alignment_jobs === 0}
          />
          {!queuesHealthy ? (
            <Text className="text-sm leading-6 text-muted">
              Failed scans are reviewed under Sources. Failed alignments are reviewed from the
              affected Work.
            </Text>
          ) : null}
        </Section>

        <Section title="Optional services">
          <DiagnosticRow
            label="Book acquisition"
            detail={
              report.acquisition_configured
                ? 'Prowlarr and qBittorrent are configured'
                : 'Not configured; local Sources still work normally'
            }
            healthy={report.acquisition_configured}
            optional
          />
        </Section>

        <Section
          title="Data and recovery"
          action={
            <Button
              label="Back up now"
              icon="backup"
              loading={creatingBackup}
              disabled={creatingBackup}
              onPress={() => void createBackup()}
            />
          }
        >
          <Text className="max-w-[70ch] text-sm leading-6 text-muted">
            Backups include the SQLite database, managed media, covers, and alignment artifacts.
            Each archive is checksummed and its database is checked before Aldus reports success.
          </Text>
          {backupMessage ? <Notice tone="success">{backupMessage}</Notice> : null}
          {backupError ? <Notice tone="danger">{backupError}</Notice> : null}
          {backupsLoading ? (
            <LoadingState label="Loading backups…" />
          ) : backups.length ? (
            <View>
              {backups.map((archive) => (
                <View
                  key={archive.name}
                  className="min-h-16 flex-row flex-wrap items-center gap-3 border-b border-line-subtle py-4"
                >
                  <View className="min-w-[220px] flex-1 gap-1">
                    <Text className="font-sans-semibold text-ink">
                      {new Date(archive.created_at).toLocaleString()}
                    </Text>
                    <Text className="text-sm text-muted">{formatBytes(archive.size_bytes)}</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {Platform.OS === 'web' ? (
                      <Button
                        label="Download"
                        icon="acquire"
                        kind="secondary"
                        onPress={() => void downloadBackup(archive)}
                      />
                    ) : null}
                    <Button
                      label="Delete"
                      icon="delete"
                      kind="danger"
                      onPress={() => setDeleteTarget(archive)}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="border-y border-line py-5">
              <Text className="font-sans-semibold text-ink">No backups yet</Text>
              <Text className="mt-1 text-sm leading-6 text-muted">
                Create one before an upgrade or configuration change.
              </Text>
            </View>
          )}
          <Text className="text-sm leading-6 text-muted">
            Keep a downloaded copy somewhere outside this server. Emergency restore remains
            available when Aldus cannot start.
          </Text>
        </Section>
      </View>
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title="Delete this backup?"
        description="This permanently removes the archive from the server. Keep a downloaded copy before deleting the last known-good backup."
        confirmLabel="Delete backup"
        danger
        busy={deletingBackup}
        onClose={() => setDeleteTarget(undefined)}
        onConfirm={() => void deleteBackup()}
      />
    </Page>
  );
}

function saveBlob(blob: Blob, filename: string) {
  if (Platform.OS !== 'web') return;
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function DiagnosticRow({
  label,
  detail,
  healthy,
  optional = false,
}: {
  label: string;
  detail: string;
  healthy: boolean;
  optional?: boolean;
}) {
  let status: { label: string; icon: AppIconName; color: string; textClass: string } = {
    label: 'Needs attention',
    icon: 'warning',
    color: colors.danger,
    textClass: 'text-danger',
  };
  if (optional) {
    status = {
      label: 'Not configured',
      icon: 'disabled',
      color: colors.muted,
      textClass: 'text-muted',
    };
  }
  if (healthy) {
    status = {
      label: 'Healthy',
      icon: 'enabled',
      color: colors.success,
      textClass: 'text-success',
    };
  }

  return (
    <View className="min-h-14 flex-row flex-wrap items-center justify-between gap-3 border-b border-line-subtle py-3">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans-semibold text-ink">{label}</Text>
        <Text className="text-sm text-muted">{detail}</Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <AppIcon name={status.icon} size={15} color={status.color} />
        <Text className={`text-xs font-sans-semibold ${status.textClass}`}>{status.label}</Text>
      </View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-sans-bold uppercase tracking-wide text-subtle">{label}</Text>
      <Text selectable className="text-sm text-ink">
        {value}
      </Text>
    </View>
  );
}
