import { describe, expect, it } from 'bun:test';
import type { AlignmentJob, Media, Representation } from '../generated/api';
import {
  audioPassage,
  audioChapterAt,
  applyPlaybackRate,
  choices,
  clampAudioPosition,
  defaultPair,
  formatAudioTime,
  listenToRead,
  playableAudioDuration,
  playbackRate,
  PLAYBACK_RATES,
  progressSaveLabel,
  progressSourceLabel,
  readToListen,
  readyJob,
  resumedProgressLabel,
  scrubberPosition,
  shouldLoadConsumptionMedia,
  sleepTimerDeadline,
  sleepTimerRemainingSeconds,
  synchronizationLabel,
} from './consumption';

it('loads only the media needed by the active consumption mode', () => {
  expect(shouldLoadConsumptionMedia('read', 'epub')).toBe(true);
  expect(shouldLoadConsumptionMedia('read', 'audio')).toBe(false);
  expect(shouldLoadConsumptionMedia('listen', 'epub')).toBe(false);
  expect(shouldLoadConsumptionMedia('listen', 'audio')).toBe(true);
});

const passageSegments = [
  {
    id: 'one',
    ordinal: 1,
    text: 'First passage.',
    epub_href: 'chapter.xhtml',
    epub_locator: {},
    koreader_locator: '',
    audio_resource: 'book.mp3',
    audio_start_ms: 100,
    audio_end_ms: 200,
    highlightable: true,
    alignment_status: 'aligned',
  },
  {
    id: 'gap',
    ordinal: 2,
    text: 'Not readable.',
    epub_href: 'chapter.xhtml',
    epub_locator: {},
    koreader_locator: '',
    audio_resource: 'book.mp3',
    audio_start_ms: 200,
    audio_end_ms: 300,
    highlightable: false,
    alignment_status: 'unresolved',
  },
  {
    id: 'two',
    ordinal: 3,
    text: 'Second passage.',
    epub_href: 'chapter.xhtml',
    epub_locator: {},
    koreader_locator: '',
    audio_resource: 'book.mp3',
    audio_start_ms: 300,
    audio_end_ms: 400,
    highlightable: true,
    alignment_status: 'aligned',
  },
];

it('uses exact segment boundaries for read-along and skips unresolved text', () => {
  expect(audioPassage(passageSegments, 0)).toMatchObject({ active: false, current: { id: 'one' } });
  expect(audioPassage(passageSegments, 100)).toMatchObject({
    active: true,
    current: { id: 'one' },
  });
  expect(audioPassage(passageSegments, 199)?.next?.id).toBe('two');
  expect(audioPassage(passageSegments, 200)).toMatchObject({
    active: false,
    current: { id: 'two' },
  });
  expect(audioPassage(passageSegments, 300)?.current.id).toBe('two');
  expect(audioPassage(passageSegments, 400)).toMatchObject({
    active: false,
    current: { id: 'two' },
  });
});

it('formats audiobook durations with hours when needed', () => {
  expect(formatAudioTime(3522)).toBe('58:42');
  expect(formatAudioTime(12932)).toBe('3:35:32');
});

it('selects audio chapters with inclusive starts and exclusive ends', () => {
  const chapters = [
    { title: 'One', start_ms: 0, end_ms: 10_000 },
    { title: 'Two', start_ms: 10_000, end_ms: 20_000 },
  ];
  expect(audioChapterAt(chapters, 9_999)?.current.title).toBe('One');
  expect(audioChapterAt(chapters, 10_000)).toMatchObject({
    index: 1,
    current: { title: 'Two' },
    previous: { title: 'One' },
  });
  expect(audioChapterAt(chapters, 20_000)).toBeUndefined();
});

it('counts sleep timers from an absolute deadline', () => {
  expect(sleepTimerDeadline(15, 1_000_000)).toBe(1_900_000);
  expect(sleepTimerDeadline(30, 1_000_000)).toBe(2_800_000);
  expect(sleepTimerDeadline(15, 2_000_000)).toBe(2_900_000);
  expect(sleepTimerDeadline(undefined, 1_000_000)).toBeUndefined();
  expect(sleepTimerRemainingSeconds(1_060_001, 1_000_000)).toBe(61);
  expect(sleepTimerRemainingSeconds(999_999, 1_000_000)).toBe(0);
  expect(sleepTimerRemainingSeconds(undefined, 1_000_000)).toBeUndefined();
});

it('labels saved progress without exposing raw device identifiers', () => {
  expect(progressSourceLabel('koreader:max:kindle')).toBe('KOReader');
  expect(progressSourceLabel('web')).toBe('Aldus web');
  expect(progressSourceLabel('unexpected-device-id')).toBe('another device');
  expect(resumedProgressLabel('koreader:max:kindle')).toBe('Resumed from KOReader');
  expect(resumedProgressLabel('android', 3522)).toBe('Resumed from Aldus on Android at 58:42');
});

it('only claims progress is saved after confirmation', () => {
  expect(progressSaveLabel('idle', 'read')).toBe('');
  expect(progressSaveLabel('saving', 'read')).toBe('Saving…');
  expect(progressSaveLabel('error', 'read')).toBe('Couldn’t save');
  expect(progressSaveLabel('offline', 'read')).toBe('Saved on this device');
  expect(progressSaveLabel('saved', 'read')).toBe('Saved here');
  expect(progressSaveLabel('saved', 'listen', 3_522_000)).toBe('Saved at 58:42');
});

const representations = [
  { id: 'r1', work_id: 'w', kind: 'epub', label: 'Book', created_at: '', updated_at: '' },
  { id: 'r2', work_id: 'w', kind: 'audio', label: 'Narration', created_at: '', updated_at: '' },
] satisfies Representation[];
const media = [
  { id: 'e1', representation_id: 'r1', kind: 'epub', sha256: 'e', size_bytes: 1, created_at: '' },
  { id: 'a1', representation_id: 'r2', kind: 'audio', sha256: 'a', size_bytes: 1, created_at: '' },
] satisfies Media[];
const job = {
  id: 'j',
  alignment_id: 'alignment',
  epub_media_id: 'e1',
  audio_media_id: 'a1',
  state: 'ready',
  attempts: 1,
  worker_version: 'worker',
  model: 'model',
  created_at: '',
} satisfies AlignmentJob;

describe('consumption selection', () => {
  it('uses the complete pitch-preserved playback speed set without changing time', () => {
    const calls: unknown[][] = [];
    const timestamp = 123.456;
    const player = { setPlaybackRate: (...args: unknown[]) => calls.push(args) };

    expect(PLAYBACK_RATES).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(applyPlaybackRate(player, 1.75)).toBe(1.75);
    expect(calls).toEqual([[1.75, 'high']]);
    expect(timestamp).toBe(123.456);
    expect(playbackRate(3)).toBe(1);
  });

  it('bounds pointer, keyboard, and accessibility seeks to media time', () => {
    expect(clampAudioPosition(-5, 60)).toBe(0);
    expect(clampAudioPosition(30, 60)).toBe(30);
    expect(clampAudioPosition(65, 60)).toBe(60);
    expect(clampAudioPosition(Number.NaN, 60)).toBe(0);
    expect(clampAudioPosition(Number.POSITIVE_INFINITY, 60)).toBe(0);
    expect(clampAudioPosition(5, Number.NaN)).toBe(0);
    expect(playableAudioDuration(Number.POSITIVE_INFINITY, 90)).toBe(90);
    expect(playableAudioDuration(120, 90)).toBe(120);
    expect(scrubberPosition(50, 100, 120)).toBe(60);
    expect(scrubberPosition(Number.NaN, 100, 120)).toBeUndefined();
  });

  it('supports EPUB-only, audio-only, and the ready exact revision pair', () => {
    const epubs = choices(representations, media, ['epub']);
    const audio = choices(representations, media, ['audio', 'audiobook']);
    expect(epubs.map((item) => item.id)).toEqual(['e1']);
    expect(audio.map((item) => item.id)).toEqual(['a1']);
    expect(defaultPair([job], epubs, audio, 'alignment')).toMatchObject({
      epub: { id: 'e1' },
      audio: { id: 'a1' },
    });
    expect(readyJob([job], 'e1', 'a1')?.alignment_id).toBe('alignment');
  });

  it('never selects stale synchronization', () => {
    const stale = { ...job, state: 'stale' };
    expect(readyJob([stale], 'e1', 'a1')).toBeUndefined();
    expect(synchronizationLabel([stale], 'e1', 'a1')).toBe('Read and Listen available separately');
  });

  it('switches only through canonical progress in both directions', async () => {
    const calls: string[] = [];
    const canonical = { alignment_id: 'alignment', segment_id: 'segment', offset: 250000 };
    const client = {
      epubToCanonical: async () => {
        calls.push('epub→canonical');
        return canonical;
      },
      audioToCanonical: async () => {
        calls.push('audio→canonical');
        return canonical;
      },
      updateWorkProgress: async () => {
        calls.push('persist');
        return { ...canonical, revision: 2 };
      },
      canonicalToAudio: async () => {
        calls.push('canonical→audio');
        return { resource: 'book.audio', timestamp_ms: 1234 };
      },
      canonicalToEPUB: async () => {
        calls.push('canonical→epub');
        return {
          href: 'chapter.xhtml',
          locator: { type: 'dom-element', dom_path: 'html[1]/body[1]/p[1]' },
          offset: 250000,
        };
      },
    };
    expect(
      (
        await readToListen(
          client,
          'work',
          'alignment',
          { href: 'chapter.xhtml', locator: {}, offset: 1 },
          1,
          'web',
        )
      ).target.timestamp_ms,
    ).toBe(1234);
    expect(
      (
        await listenToRead(
          client,
          'work',
          'alignment',
          { resource: 'book.audio', timestamp_ms: 1234 },
          2,
          'web',
        )
      ).target.href,
    ).toBe('chapter.xhtml');
    expect(calls).toEqual([
      'epub→canonical',
      'persist',
      'canonical→audio',
      'audio→canonical',
      'persist',
      'canonical→epub',
    ]);
  });
});
