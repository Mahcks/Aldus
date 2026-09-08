import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AlignmentJob } from '@/generated/api';
import { api } from '@/lib/api';
import { Text, View } from '@/features/tw';

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

export function AlignmentProgress({
  job,
  unreachable = false,
}: {
  job: AlignmentJob;
  unreachable?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const start = Date.parse(job.started_at || job.created_at);
  const minutes = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 60000)) : 0;
  const elapsed = minutes < 1 ? 'Less than a minute' : `${minutes} min`;

  return (
    <View className="gap-2" accessibilityLiveRegion="polite">
      <Text className="text-base font-sans-semibold text-ink">
        {job.state === 'pending'
          ? 'Waiting for the alignment worker'
          : stages[job.stage || ''] || 'Preparing read & listen'}
      </Text>
      <Text className="text-sm text-muted">
        {elapsed} {job.state === 'pending' ? 'in queue' : 'elapsed'}
      </Text>
      <Text className="max-w-[680px] text-sm leading-5 text-muted">
        {unreachable
          ? 'Cannot refresh progress. Reconnecting automatically; the server may still be working.'
          : 'You can leave this page. Long audiobooks can take a while; timing depends on your server.'}
      </Text>
    </View>
  );
}
