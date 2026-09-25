import { DiagnosticMeta } from './SystemDiagnostics';
import { Button, Notice, Section, StatusBadge, type StatusTone } from '@/components/ui';
import { fadeIn, fadeOut, layoutShift, reveal, revealExit } from '@/components/ui/motion';
import { AnimatedView, Text, View } from '@/components/ui/tw';
import type {
  AlignmentGpuStatus,
  GpuTestState,
  AlignmentReadiness,
} from '@/hooks/administration/useAlignmentGpuStatus';

function gpuTestStatus(state: GpuTestState): { tone: StatusTone; label: string } {
  switch (state) {
    case 'checking':
      return { tone: 'info', label: 'Checking…' };
    case 'success':
      return { tone: 'success', label: 'Working' };
    case 'failed':
      return { tone: 'danger', label: 'Failed' };
    case 'not_applicable':
      return { tone: 'neutral', label: 'Not applicable' };
    case 'not_checked':
    default:
      return { tone: 'neutral', label: 'Not checked' };
  }
}

/**
 * Deliberately never derives from `gpuTest` — GPU execution and alignment
 * readiness are two separate facts the server will report separately, and
 * this section exists specifically because collapsing them (a working GPU
 * always meaning "ready", or a configured accelerator implying a GPU was
 * actually found) hides real failure states from an admin.
 */
function alignmentStatus(readiness: AlignmentReadiness): { tone: StatusTone; label: string } {
  switch (readiness) {
    case 'ready':
      return { tone: 'success', label: 'Ready' };
    case 'not_ready':
      return { tone: 'danger', label: 'Not ready' };
    case 'unknown':
    default:
      return { tone: 'neutral', label: 'Not checked' };
  }
}

/** Same row shape as `DiagnosticRow`, but for a status with more than two states — reuses `StatusBadge`'s full tone set instead of a binary healthy flag. */
function StatusRow({
  label,
  detail,
  tone,
  statusLabel,
}: {
  label: string;
  detail?: string;
  tone: StatusTone;
  statusLabel: string;
}) {
  return (
    <AnimatedView
      layout={layoutShift}
      className="min-h-14 flex-row flex-wrap items-center justify-between gap-3 border-b border-line-subtle py-3"
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans-semibold text-ink">{label}</Text>
        {detail ? <Text className="text-sm text-muted">{detail}</Text> : null}
      </View>
      <AnimatedView key={statusLabel} entering={fadeIn} exiting={fadeOut}>
        <StatusBadge tone={tone} label={statusLabel} />
      </AnimatedView>
    </AnimatedView>
  );
}

export function AlignmentGpuSection({
  status,
  checking,
  onTestGpu,
  error,
}: {
  status: AlignmentGpuStatus;
  checking: boolean;
  error?: string;
  onTestGpu: () => void;
}) {
  const usesCpu = status.accelerator === 'cpu';
  const gpu = gpuTestStatus(status.gpuTest.state);
  const alignment = alignmentStatus(status.alignment.readiness);

  return (
    <Section
      title="Alignment"
      action={
        <Button
          label={checking ? 'Checking…' : 'Check readiness'}
          icon="scan"
          disabled={checking}
          onPress={onTestGpu}
        />
      }
    >
      {error ? (
        <AnimatedView entering={reveal} exiting={revealExit}>
          <Notice danger>{error}</Notice>
        </AnimatedView>
      ) : null}
      <Text className="max-w-[70ch] text-sm leading-6 text-muted">
        {usesCpu
          ? 'Alignment uses your CPU to match ebook text with audiobook audio. No GPU is required.'
          : 'Check whether Aldus can align ebooks with audiobooks. When CUDA is configured, this also tests GPU execution.'}
      </Text>

      <Text className="text-sm text-muted">
        This offline check initializes the configured models. It can take up to 90 seconds and is
        unavailable while alignment is running. A successful check does not test a particular book.
      </Text>
      <View className="flex-row flex-wrap gap-x-8 gap-y-2 pt-1">
        <DiagnosticMeta label="Processing mode" value={status.acceleratorLabel} />
        {!usesCpu ? <DiagnosticMeta label="Detected GPU" value={status.detectedGpu} /> : null}
      </View>

      <View>
        {!usesCpu ? (
          <StatusRow
            label="GPU test"
            detail={status.gpuTest.detail}
            tone={gpu.tone}
            statusLabel={gpu.label}
          />
        ) : null}
        {!usesCpu && status.gpuTest.state === 'failed' && status.gpuTest.error ? (
          <AnimatedView
            entering={reveal}
            exiting={revealExit}
            layout={layoutShift}
            className="pt-3"
          >
            <Notice danger>{status.gpuTest.error}</Notice>
          </AnimatedView>
        ) : null}

        <StatusRow
          label="Alignment readiness"
          tone={alignment.tone}
          statusLabel={checking ? 'Checking…' : alignment.label}
        />
        {status.alignment.readiness === 'not_ready' && status.alignment.issues.length > 0 ? (
          <AnimatedView
            entering={reveal}
            exiting={revealExit}
            layout={layoutShift}
            className="gap-2 pt-3"
          >
            {status.alignment.issues.map((issue) => (
              <Notice key={issue} tone="warning">
                {issue}
              </Notice>
            ))}
          </AnimatedView>
        ) : null}
      </View>

      <Text className="text-xs text-subtle">
        Last checked:{' '}
        {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : 'Never'}
      </Text>
    </Section>
  );
}
