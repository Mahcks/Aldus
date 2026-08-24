import type { SystemDiagnostics } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  Button,
  ErrorState,
  LoadingState,
  Notice,
  Page,
  Section,
  StatusBadge,
} from '../../features/ui';
import { Text, View } from '../../features/tw';
import { api, errorMessage } from '../../lib/api';

export default function SystemAdministration() {
  const auth = useAuth();
  const [report, setReport] = useState<SystemDiagnostics>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setReport(await api.systemDiagnostics());
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void api
      .systemDiagnostics()
      .then((value) => active && setReport(value))
      .catch((value) => active && setError(errorMessage(value)))
      .finally(() => active && setLoading(false));
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
          <View className="flex-row flex-wrap gap-x-8 gap-y-2 border-t border-line-subtle pt-4">
            <Meta label="Version" value={report.version} />
            <Meta label="Environment" value={report.environment} />
          </View>
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

        <Section title="Backup and recovery">
          <Text className="max-w-[70ch] text-sm leading-6 text-muted">
            Backups include the SQLite database, managed media, covers, and alignment artifacts.
            Each archive is checksummed and its database is checked before Aldus reports success.
          </Text>
          <View className="gap-1 rounded-control border border-line bg-panel px-4 py-3">
            <Text selectable className="font-mono text-sm text-ink">
              docker compose run --rm aldus backup --archive /backups/aldus.tar.gz
            </Text>
          </View>
          <Text className="text-sm leading-6 text-muted">
            Restore only while the server is stopped and the destination data volume is empty.
          </Text>
        </Section>
      </View>
    </Page>
  );
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
  return (
    <View className="min-h-14 flex-row flex-wrap items-center justify-between gap-3 border-b border-line-subtle py-3">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans-semibold text-ink">{label}</Text>
        <Text className="text-sm text-muted">{detail}</Text>
      </View>
      <StatusBadge
        tone={healthy ? 'success' : optional ? 'neutral' : 'danger'}
        label={healthy ? 'Healthy' : optional ? 'Not configured' : 'Needs attention'}
        icon={healthy ? 'enabled' : optional ? 'disabled' : 'warning'}
      />
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
