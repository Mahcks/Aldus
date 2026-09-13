import { useServerMaintenance } from '@/hooks/administration/useServerMaintenance';
import { DiagnosticRow, DiagnosticMeta } from '@/components/administration/SystemDiagnostics';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button, ConfirmDialog, ErrorState, LoadingState, Notice, Section } from '@/components/ui';
import { Page } from '@/components/shell/Page';
import { Text, View } from '@/components/ui/tw';
import { formatBytes } from '@/lib/administration/system-presentation';

export default function SystemAdministration() {
  const auth = useAuth();
  const {
    report,
    loading,
    error,
    backups,
    backupError,
    backupMessage,
    backupsLoading,
    creatingBackup,
    deletingBackup,
    deleteTarget,
    setDeleteTarget,
    refresh,
    createBackup,
    downloadBackup,
    deleteBackup,
    downloadDiagnostics,
  } = useServerMaintenance();
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
            <DiagnosticMeta label="Version" value={report.version} />
            <DiagnosticMeta label="Environment" value={report.environment} />
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
