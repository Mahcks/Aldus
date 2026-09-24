import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AlignmentJob } from '@/generated/api';
import { api } from '@/lib/api';
import { AppIcon } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Ordered — index in this list is what `StageStepper` uses to mark steps done/current/upcoming. */
const stageOrder = [
  'preparing',
  'loading_audio',
  'loading_model',
  'transcribing',
  'loading_alignment_model',
  'aligning_words',
  'matching_text',
  'validating',
] as const;

const stages: Record<string, string> = {
  preparing: 'Preparing source files',
  loading_audio: 'Loading the audiobook',
  loading_model: 'Loading the speech model',
  transcribing: 'Transcribing the narration',
  loading_alignment_model: 'Loading the word timing model',
  aligning_words: 'Finding word timings',
  matching_text: 'Matching narration to the ebook',
  validating: 'Checking and saving the alignment',
};

export function alignmentRunning(job: AlignmentJob) {
  return job.state === 'pending' || job.state === 'processing';
}

export function useAlignmentPolling(
  workID: string,
  enabled: boolean,
  setJobs: Dispatch<SetStateAction<AlignmentJob[]>>,
) {
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (!enabled || !workID) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const jobs = await api.alignmentJobs(workID);
        if (!disposed) {
          setUnreachable(false);
          setJobs(jobs);
        }
      } catch {
        if (!disposed) setUnreachable(true);
      } finally {
        if (!disposed) timer = setTimeout(refresh, 3000);
      }
    }

    timer = setTimeout(refresh, 3000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [workID, enabled, setJobs]);

  return enabled && unreachable;
}

/** Small pulsing ring marking the step currently running — the only animated element, so it draws the eye without the whole list feeling busy. */
function CurrentStepPulse() {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) return;
    scale.set(
      withRepeat(
        withTiming(1.6, {
          duration: 1100,
          easing: Easing.out(Easing.ease),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      ),
    );
  }, [reducedMotion, scale]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    opacity: reducedMotion ? 0.4 : Math.max(0, 1.6 - scale.get()),
  }));

  return (
    <View className="h-[18px] w-[18px] items-center justify-center">
      <Animated.View
        pointerEvents="none"
        style={ringStyle}
        className="absolute h-[18px] w-[18px] rounded-full bg-accent/40"
      />
      <View className="h-[10px] w-[10px] rounded-full bg-accent" />
    </View>
  );
}

/**
 * Every step the server actually reports (`stageOrder`), shown at once — a
 * reader watching this sees forward motion through a known, finite list
 * instead of one line of text that occasionally changes with no sense of
 * how much is left. `currentStage` undefined (job still `pending`) reads as
 * "about to start step one" rather than nothing happening yet.
 */
function StageStepper({ currentStage }: { currentStage?: string }) {
  const currentIndex = Math.max(
    0,
    currentStage ? stageOrder.indexOf(currentStage as (typeof stageOrder)[number]) : 0,
  );
  const colors = useThemeColors();

  return (
    <View className="relative gap-0 pt-1">
      <View
        pointerEvents="none"
        className="absolute bottom-[14px] left-[8px] top-[14px] w-px bg-line"
      />
      {stageOrder.map((key, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <View key={key} className="flex-row items-center gap-3 py-1.5">
            {done ? (
              <View className="h-[18px] w-[18px] items-center justify-center rounded-full bg-success">
                <AppIcon name="check" size={12} color={colors.onAccent} />
              </View>
            ) : current ? (
              <CurrentStepPulse />
            ) : (
              <View className="h-[18px] w-[18px] rounded-full border border-line bg-paper" />
            )}
            <Text
              className={
                current
                  ? 'text-sm font-sans-bold text-ink'
                  : done
                    ? 'text-sm text-ink'
                    : 'text-sm text-subtle'
              }
            >
              {stages[key]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Elapsed time ticks every second (not the old 15s) and reads in seconds
 * for the first minute — the window where a flat "Less than a minute" label
 * felt most static, since that's often most of a short audiobook's sync time.
 */
function useElapsedLabel(startedAt?: string, createdAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const start = Date.parse(startedAt || createdAt || '');
  const elapsedSeconds = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
  return elapsedSeconds < 60 ? `${elapsedSeconds}s` : `${Math.floor(elapsedSeconds / 60)} min`;
}

export function AlignmentProgress({
  job,
  unreachable = false,
  compact = false,
}: {
  job: AlignmentJob;
  unreachable?: boolean;
  /** Public work page: header + elapsed time only, no step list — full detail lives on the Manage page's Sync tab. */
  compact?: boolean;
}) {
  const elapsed = useElapsedLabel(job.started_at, job.created_at);
  const currentIndex = job.stage
    ? Math.max(0, stageOrder.indexOf(job.stage as (typeof stageOrder)[number]))
    : 0;

  return (
    <View className="gap-2" accessibilityLiveRegion="polite">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-base font-sans-semibold text-ink">
          {job.state === 'pending'
            ? 'Waiting for the alignment worker'
            : compact
              ? stages[job.stage || ''] || 'Preparing read & listen'
              : 'Synchronizing read & listen'}
        </Text>
        <Text className="text-xs font-sans-bold text-subtle">
          Step {currentIndex + 1} of {stageOrder.length}
        </Text>
      </View>
      <Text className="text-sm text-muted">
        {elapsed} {job.state === 'pending' ? 'in queue' : 'elapsed'}
      </Text>
      {!compact ? <StageStepper currentStage={job.stage} /> : null}
      <Text className="max-w-[680px] text-sm leading-5 text-muted">
        {unreachable
          ? 'Cannot refresh progress. Reconnecting automatically; the server may still be working.'
          : 'You can leave this page. Long audiobooks can take a while; timing depends on your server.'}
      </Text>
    </View>
  );
}
