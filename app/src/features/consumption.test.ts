import { describe, expect, it } from 'bun:test';
import type { AlignmentJob, Media, Representation } from '../generated/api';
import {
  choices,
  defaultPair,
  listenToRead,
  readToListen,
  readyJob,
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
