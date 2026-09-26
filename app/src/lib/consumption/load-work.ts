import type { ReadingClaim } from '@/generated/api';
import { api } from '@/lib/api';
import { pendingProgress } from '@/lib/progress-outbox';
import { choices, defaultPair, pendingCanonicalProgress } from './consumption';

/** Fetch the work and choose its requested or saved reading/listening editions. */
export async function loadConsumptionWork({
  id,
  epub,
  audio,
  snapshot,
}: {
  id: string;
  epub?: string;
  audio?: string;
  snapshot?: ReadingClaim;
}) {
  const workRequest = api.work(id);
  const representationsRequest = api.representations(id);
  // Media only depends on the work and its editions, not progress or settings.
  const revisionsRequest = Promise.all([workRequest, representationsRequest]).then(
    async ([work, representations]) =>
      (
        await Promise.all(
          representations.map((representation) => api.media(work.library_id, representation.id)),
        )
      ).flat(),
  );
  const [
    nextWork,
    representations,
    nextJobs,
    nextProgress,
    preference,
    nextReaderDefaults,
    revisions,
  ] = await Promise.all([
    workRequest,
    representationsRequest,
    api.alignmentJobs(id),
    snapshot ? (snapshot.progress ?? null) : api.workProgress(id),
    api.workPreference(id),
    api.readerPreferences(),
    revisionsRequest,
  ]);
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
  const pending = await pendingProgress(id);
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
    pending,
    serverProgress: nextProgress,
  };
}
