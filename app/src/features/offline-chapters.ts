import type { AudioChapter } from '@/generated/api';

export function offlineAudioChapters(value: unknown): Record<string, AudioChapter[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, AudioChapter[]] =>
        Array.isArray(entry[1]) &&
        entry[1].every(
          (chapter) =>
            chapter !== null &&
            typeof chapter === 'object' &&
            typeof chapter.title === 'string' &&
            Number.isFinite(chapter.start_ms) &&
            Number.isFinite(chapter.end_ms) &&
            chapter.start_ms >= 0 &&
            chapter.end_ms > chapter.start_ms,
        ),
    ),
  );
}
