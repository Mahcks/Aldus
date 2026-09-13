import { Platform } from 'react-native';
import { api } from '@/lib/api';
import { pendingProgress } from '@/lib/progress-outbox';
import { choices, defaultPair, pendingCanonicalProgress } from './consumption';

/** Fetch the work and choose its requested or saved reading/listening editions. */
export async function loadConsumptionWork({
  id,
  epub,
  audio,
}: {
  id: string;
  epub?: string;
  audio?: string;
}) {
  const [nextWork, representations, nextJobs, nextProgress, preference, nextReaderDefaults] =
    await Promise.all([
      api.work(id),
      api.representations(id),
      api.alignmentJobs(id),
      api.workProgress(id),
      api.workPreference(id),
      api.readerPreferences(),
    ]);
  const revisions = (
    await Promise.all(
      representations.map((representation) => api.media(nextWork.library_id, representation.id)),
    )
  ).flat();
  const nextEPUBs = choices(representations, revisions, ['epub']);
  const nextAudio = choices(representations, revisions, ['audio', 'audiobook']);
  const pair = defaultPair(
    nextJobs,
    nextEPUBs,
    nextAudio,
    preference?.alignment_id ?? nextProgress?.alignment_id,
  );
  const nextEPUB = nextEPUBs.find((item) => item.id === epub) ?? pair.epub;
  const nextAudioChoice = nextAudio.find((item) => item.id === audio) ?? pair.audio;
  const pending = Platform.OS === 'web' ? null : await pendingProgress(id);
  const effectiveProgress = pendingCanonicalProgress(nextProgress, pending);
  return {
    nextWork,
    nextJobs,
    nextReaderDefaults,
    nextEPUBs,
    nextAudio,
    nextEPUB,
    nextAudioChoice,
    effectiveProgress,
  };
}
