import type { Alignment, CanonicalPosition } from '@/generated/api';

// Display only: never use a percentage to restore a reading position.
export function editionCompletion(locator: unknown): number | undefined {
  if (!locator || typeof locator !== 'object') return undefined;
  const value = locator as {
    totalProgression?: unknown;
    locations?: { totalProgression?: unknown };
    cfi?: string;
  };
  let fraction = value.totalProgression ?? value.locations?.totalProgression;
  if (fraction == null && value.cfi) {
    try {
      fraction = JSON.parse(value.cfi)?.locations?.totalProgression;
    } catch {
      /* Web CFIs are not JSON. */
    }
  }
  return typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
    ? Math.floor(fraction * 100)
    : undefined;
}

export function offlineCompletion(
  progress: CanonicalPosition | null,
  alignment: Alignment | undefined,
  locator: unknown,
  fallback: number,
  audio?: { timestamp: number; duration: number },
) {
  if (progress && alignment?.id === progress.alignment_id) {
    const segment = alignment.segments.find((item) => item.id === progress.segment_id);
    const last = alignment.segments
      .filter((item) => item.highlightable)
      .reduce((max, item) => Math.max(max, item.ordinal), -1);
    if (segment && last >= 0)
      return Math.max(
        0,
        Math.min(
          100,
          Math.floor(((segment.ordinal + progress.offset / 1_000_000) * 100) / (last + 1)),
        ),
      );
  }
  if (
    audio &&
    Number.isFinite(audio.timestamp) &&
    Number.isFinite(audio.duration) &&
    audio.duration > 0
  )
    return Math.max(0, Math.min(100, Math.floor((audio.timestamp * 100) / audio.duration)));
  return editionCompletion(locator) ?? fallback;
}
