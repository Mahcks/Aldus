import type { Alignment, AudioLocator, CanonicalPosition, EPUBLocator } from '@/generated/api';

const OFFSET_MAX = 1_000_000;
type TimedWord = { startTime: number; endTime: number; text: string };

function timedWords(value: unknown): TimedWord[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return;
  const words = value.filter(
    (word): word is TimedWord =>
      Boolean(word) &&
      typeof word.text === 'string' &&
      word.text !== '' &&
      typeof word.startTime === 'number' &&
      word.startTime > 0 &&
      typeof word.endTime === 'number' &&
      word.endTime >= word.startTime,
  );
  return words.length === value.length ? words : undefined;
}

function wordOffset(text: string | undefined, value: unknown, timestampMS: number) {
  const timings = timedWords(value);
  const normalized = (text ?? '').trim().split(/\s+/).join(' ');
  const words = normalized ? normalized.split(' ') : [];
  if (!timings || words.length === 0) return;
  let index = timings.findIndex((word) => timestampMS <= word.endTime * 1000);
  if (index < 0) index = timings.length - 1;
  index = Math.min(index, words.length - 1);
  const cursor = Array.from(words.slice(0, index).join(' ')).length + (index > 0 ? 1 : 0);
  return Math.floor((cursor * OFFSET_MAX) / Array.from(normalized).length);
}

function wordTimestamp(text: string | undefined, value: unknown, offset: number) {
  const timings = timedWords(value);
  const normalized = (text ?? '').trim().split(/\s+/).join(' ');
  const words = normalized ? normalized.split(' ') : [];
  if (!timings || words.length === 0) return;
  const position = Math.floor((offset * Array.from(normalized).length) / OFFSET_MAX);
  let cursor = 0;
  for (let index = 0; index < words.length; index++) {
    const end = cursor + Array.from(words[index]!).length;
    if (position < end)
      return Math.round((timings[Math.min(index, timings.length - 1)]?.startTime ?? 0) * 1000);
    cursor = end + 1;
  }
  return Math.round(timings[timings.length - 1]!.startTime * 1000);
}

export function offlineEPUBToCanonical(
  alignmentID: string,
  locator: EPUBLocator,
): CanonicalPosition | undefined {
  if (!locator.locator || typeof locator.locator !== 'object') return;
  const segmentID = (locator.locator as { segment_id?: unknown }).segment_id;
  if (typeof segmentID !== 'string') return;
  return { alignment_id: alignmentID, segment_id: segmentID, offset: locator.offset };
}

export function offlineAudioToCanonical(
  alignment: Alignment,
  locator: AudioLocator,
): CanonicalPosition | undefined {
  if (!locator.resource || locator.timestamp_ms < 0) return;
  const segment = alignment.segments
    .filter((item) => item.highlightable && item.audio_resource === locator.resource)
    .reduce<(typeof alignment.segments)[number] | undefined>((nearest, item) => {
      if (!nearest) return item;
      const contains =
        item.audio_start_ms <= locator.timestamp_ms && item.audio_end_ms > locator.timestamp_ms;
      const nearestContains =
        nearest.audio_start_ms <= locator.timestamp_ms &&
        nearest.audio_end_ms > locator.timestamp_ms;
      if (contains !== nearestContains) return contains ? item : nearest;
      const distance =
        locator.timestamp_ms < item.audio_start_ms
          ? item.audio_start_ms - locator.timestamp_ms
          : Math.max(0, locator.timestamp_ms - item.audio_end_ms);
      const nearestDistance =
        locator.timestamp_ms < nearest.audio_start_ms
          ? nearest.audio_start_ms - locator.timestamp_ms
          : Math.max(0, locator.timestamp_ms - nearest.audio_end_ms);
      return distance < nearestDistance ? item : nearest;
    }, undefined);
  if (!segment || segment.audio_end_ms <= segment.audio_start_ms) return;
  const exactOffset =
    locator.timestamp_ms > segment.audio_start_ms && locator.timestamp_ms < segment.audio_end_ms
      ? wordOffset(segment.text, segment.word_timings, locator.timestamp_ms)
      : undefined;
  return {
    alignment_id: alignment.id,
    segment_id: segment.id,
    offset:
      locator.timestamp_ms <= segment.audio_start_ms
        ? 0
        : locator.timestamp_ms >= segment.audio_end_ms
          ? OFFSET_MAX
          : (exactOffset ??
            Math.floor(
              ((locator.timestamp_ms - segment.audio_start_ms) * OFFSET_MAX) /
                (segment.audio_end_ms - segment.audio_start_ms),
            )),
  };
}

export function offlineCanonicalToEPUB(
  alignment: Alignment,
  position: CanonicalPosition,
): EPUBLocator | undefined {
  const segment = alignment.segments.find(
    (item) => item.highlightable && item.id === position.segment_id,
  );
  if (!segment) return;
  return { href: segment.epub_href, locator: segment.epub_locator, offset: position.offset };
}

export function offlineCanonicalToAudio(
  alignment: Alignment,
  position: CanonicalPosition,
): AudioLocator | undefined {
  const segment = alignment.segments.find(
    (item) => item.highlightable && item.id === position.segment_id,
  );
  if (!segment) return;
  const exactTimestamp = wordTimestamp(segment.text, segment.word_timings, position.offset);
  return {
    resource: segment.audio_resource,
    timestamp_ms:
      exactTimestamp ??
      segment.audio_start_ms +
        Math.floor(
          ((segment.audio_end_ms - segment.audio_start_ms) * position.offset) / OFFSET_MAX,
        ),
  };
}
