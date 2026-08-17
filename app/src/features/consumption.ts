import type {
  AlignmentJob,
  AlignmentSegment,
  AudioLocator,
  CanonicalPosition,
  EPUBLocator,
  Media,
  Representation,
  WorkProgressUpdate,
} from '../generated/api';

export type MediaChoice = Media & { representation: Representation };

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function audioPassage(segments: AlignmentSegment[] | undefined, timestampMS: number) {
  if (!segments || !Number.isFinite(timestampMS)) return undefined;
  const readable = segments.filter((segment) => segment.highlightable && segment.text.trim());
  const activeIndex = readable.findIndex(
    (segment) => segment.audio_start_ms <= timestampMS && timestampMS < segment.audio_end_ms,
  );
  const nextIndex = readable.findIndex((segment) => segment.audio_start_ms > timestampMS);
  const index = activeIndex >= 0 ? activeIndex : nextIndex >= 0 ? nextIndex : readable.length - 1;
  if (index < 0) return undefined;
  return {
    active: activeIndex >= 0,
    previous: readable[index - 1],
    current: readable[index],
    next: readable[index + 1],
    following: readable[index + 2],
  };
}

export function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = String(whole % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function progressSourceLabel(source?: string) {
  if (source?.startsWith('koreader')) return 'KOReader';
  if (source === 'web') return 'Aldus web';
  if (source === 'ios') return 'Aldus on iOS';
  if (source === 'android') return 'Aldus on Android';
  return 'another device';
}

export function resumedProgressLabel(source?: string, audioSeconds?: number) {
  const position = audioSeconds == null ? '' : ` at ${formatAudioTime(audioSeconds)}`;
  return `Resumed from ${progressSourceLabel(source)}${position}`;
}

export function progressSaveLabel(
  state: 'idle' | 'saving' | 'saved' | 'offline' | 'error',
  mode: 'read' | 'listen',
  audioMilliseconds?: number,
) {
  if (state === 'saving') return 'Saving…';
  if (state === 'offline') return 'Saved on this device';
  if (state === 'error') return 'Couldn’t save';
  if (state !== 'saved') return '';
  return mode === 'listen' && audioMilliseconds != null
    ? `Saved at ${formatAudioTime(audioMilliseconds / 1000)}`
    : 'Saved here';
}

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
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration < 0) return 0;
  return Math.max(0, Math.min(duration, seconds));
}

export function playableAudioDuration(duration: number, alignedDuration: number) {
  if (Number.isFinite(duration) && duration > 0) return duration;
  return Number.isFinite(alignedDuration) && alignedDuration > 0 ? alignedDuration : 0;
}

export function scrubberPosition(locationX: number, width: number, duration: number) {
  if (![locationX, width, duration].every(Number.isFinite) || width <= 0 || duration <= 0)
    return undefined;
  return clampAudioPosition((locationX / width) * duration, duration);
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
