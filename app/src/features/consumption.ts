import type {
  AlignmentJob,
  AudioLocator,
  CanonicalPosition,
  EPUBLocator,
  Media,
  Representation,
  WorkProgressUpdate,
} from '../generated/api';

export type MediaChoice = Media & { representation: Representation };

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function playbackRate(rate?: number) {
  return PLAYBACK_RATES.find((candidate) => candidate === rate) ?? 1;
}

export function applyPlaybackRate(
  player: { setPlaybackRate: (rate: number, quality?: 'low' | 'medium' | 'high') => void },
  rate?: number,
) {
  const next = playbackRate(rate);
  player.setPlaybackRate(next, 'high');
  return next;
}

export function clampAudioPosition(seconds: number, duration: number) {
  return Math.max(0, Math.min(Number.isFinite(duration) ? duration : 0, seconds));
}

export function choices(representations: Representation[], media: Media[], kinds: string[]) {
  return representations.flatMap((representation) =>
    kinds.includes(representation.kind)
      ? media
          .filter((item) => item.representation_id === representation.id)
          .map((item) => ({ ...item, representation }))
      : [],
  );
}

export function readyJob(jobs: AlignmentJob[], epubID?: string, audioID?: string) {
  return jobs.find(
    (job) =>
      job.state === 'ready' &&
      Boolean(job.alignment_id) &&
      job.epub_media_id === epubID &&
      job.audio_media_id === audioID,
  );
}

export function defaultPair(
  jobs: AlignmentJob[],
  epubs: MediaChoice[],
  audio: MediaChoice[],
  alignmentID?: string,
) {
  const preferred =
    jobs.find((job) => job.state === 'ready' && job.alignment_id === alignmentID) ??
    jobs.find(
      (job) =>
        job.state === 'ready' &&
        epubs.some((item) => item.id === job.epub_media_id) &&
        audio.some((item) => item.id === job.audio_media_id),
    );
  return {
    epub: epubs.find((item) => item.id === preferred?.epub_media_id) ?? epubs[0],
    audio: audio.find((item) => item.id === preferred?.audio_media_id) ?? audio[0],
  };
}

export function synchronizationLabel(jobs: AlignmentJob[], epubID?: string, audioID?: string) {
  if (!epubID || !audioID)
    return epubID
      ? 'Reading available'
      : audioID
        ? 'Listening available'
        : 'No readable or listenable media';
  if (readyJob(jobs, epubID, audioID)) return 'Read + Listen available';
  if (
    jobs.some(
      (job) =>
        job.epub_media_id === epubID &&
        job.audio_media_id === audioID &&
        (job.state === 'pending' || job.state === 'processing'),
    )
  )
    return 'Synchronization processing';
  if (
    jobs.some(
      (job) =>
        job.epub_media_id === epubID && job.audio_media_id === audioID && job.state === 'stale',
    )
  )
    return 'Read and Listen available separately';
  return 'Synchronization unavailable for this pairing';
}

type SyncClient = {
  epubToCanonical: (alignmentID: string, locator: EPUBLocator) => Promise<CanonicalPosition>;
  audioToCanonical: (alignmentID: string, locator: AudioLocator) => Promise<CanonicalPosition>;
  canonicalToEPUB: (alignmentID: string, position: CanonicalPosition) => Promise<EPUBLocator>;
  canonicalToAudio: (alignmentID: string, position: CanonicalPosition) => Promise<AudioLocator>;
  updateWorkProgress: (workID: string, update: WorkProgressUpdate) => Promise<CanonicalPosition>;
};

export async function readToListen(
  client: SyncClient,
  workID: string,
  alignmentID: string,
  locator: EPUBLocator,
  expectedRevision: number,
  sourceDevice: string,
) {
  const canonical = await client.epubToCanonical(alignmentID, locator);
  const progress = await client.updateWorkProgress(workID, {
    alignment_id: alignmentID,
    segment_id: canonical.segment_id,
    offset: canonical.offset,
    expected_revision: expectedRevision,
    source_device: sourceDevice,
  });
  return { progress, target: await client.canonicalToAudio(alignmentID, canonical) };
}

export async function listenToRead(
  client: SyncClient,
  workID: string,
  alignmentID: string,
  locator: AudioLocator,
  expectedRevision: number,
  sourceDevice: string,
) {
  const canonical = await client.audioToCanonical(alignmentID, locator);
  const progress = await client.updateWorkProgress(workID, {
    alignment_id: alignmentID,
    segment_id: canonical.segment_id,
    offset: canonical.offset,
    expected_revision: expectedRevision,
    source_device: sourceDevice,
  });
  return { progress, target: await client.canonicalToEPUB(alignmentID, canonical) };
}
