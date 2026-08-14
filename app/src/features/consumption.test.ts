import { describe, expect, it } from 'bun:test';
import type { AlignmentJob, Media, Representation } from '../generated/api';
import {
  applyPlaybackRate,
  choices,
  clampAudioPosition,
  defaultPair,
  listenToRead,
  playableAudioDuration,
  playbackRate,
  PLAYBACK_RATES,
  readToListen,
  readyJob,
  scrubberPosition,
  synchronizationLabel,
} from './consumption';

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
