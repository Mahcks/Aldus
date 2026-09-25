import { expect, test } from 'bun:test';
import type { AlignmentSegment } from '@/generated/api';
import { readAlongChunkIndex, readAlongChunks, readAlongWindow } from './read-along';

const text =
  'This sentence is deliberately long enough to require several small chunks on a phone while keeping every single word of the original passage in exactly the same order. Another sentence follows with a little more context.';
const words = text.split(' ');
const segment = {
  text,
  audio_start_ms: 1000,
  audio_end_ms: 1000 + words.length * 500,
  word_timings: words.map((word, index) => ({
    text: word,
    startTime: 1 + index * 0.5,
    endTime: 1.4 + index * 0.5,
  })),
} as AlignmentSegment;

test('read-along chunks preserve text and follow exact word starts, including seeks and pauses', () => {
  const original = JSON.stringify(segment);
  const chunks = readAlongChunks(segment);
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  expect(chunks.map((chunk) => chunk.text).join(' ')).toBe(text);
  expect(chunks.every((chunk) => chunk.text.split(' ').length <= 30)).toBe(true);
  for (let index = 1; index < chunks.length; index++) {
    expect(readAlongChunkIndex(chunks, chunks[index].startMS - 1)).toBe(index - 1);
    expect(readAlongChunkIndex(chunks, chunks[index].startMS)).toBe(index);
    expect(readAlongChunkIndex(chunks, chunks[index].startMS)).toBe(index);
  }
  expect(readAlongChunkIndex(chunks, 0)).toBe(0);
  expect(readAlongChunkIndex(chunks, 999999)).toBe(chunks.length - 1);
  expect(readAlongChunkIndex(chunks, 1000)).toBe(0);
  expect(JSON.stringify(segment)).toBe(original);
});

test('legacy timings work; partial or invalid timings still produce bounded, labeled chunks', () => {
  const timings = segment.word_timings as { text: string; startTime: number; endTime: number }[];
  expect(
    readAlongChunks({
      ...segment,
      word_timings: timings.map((w) => ({ word: w.text, start: w.startTime, end: w.endTime })),
    }),
  ).toEqual(readAlongChunks(segment));
  for (const word_timings of [
    undefined,
    [],
    timings.slice(1),
    [{ ...timings[0], text: 'wrong' }, ...timings.slice(1)],
    [{ ...timings[0], startTime: -1 }, ...timings.slice(1)],
  ]) {
    const chunks = readAlongChunks({ ...segment, word_timings });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.map((chunk) => chunk.text).join(' ')).toBe(text);
    expect(chunks.every((chunk) => chunk.estimated && chunk.text.split(' ').length <= 30)).toBe(
      true,
    );
    expect(chunks[0].startMS).toBe(segment.audio_start_ms);
    for (let index = 1; index < chunks.length; index++) {
      expect(chunks[index].startMS).toBeGreaterThan(chunks[index - 1].startMS);
      expect(chunks[index].startMS).toBeLessThan(segment.audio_end_ms);
      expect(readAlongChunkIndex(chunks, chunks[index].startMS)).toBe(index);
    }
  }
});

function passageOf(ordinal: number) {
  const make = (value: number) => ({ id: `s${value}`, ordinal: value }) as AlignmentSegment;
  return { previous: ordinal > 0 ? make(ordinal - 1) : undefined, current: make(ordinal) };
}

test('read-along window builds forward, trims the top, and rebuilds on a jump', () => {
  let window = readAlongWindow([], passageOf(4));
  expect(window.reset).toBe(true);
  expect(window.segments.map((s) => s.id)).toEqual(['s3', 's4']);

  window = readAlongWindow(window.segments, passageOf(5));
  expect(window).toMatchObject({ reset: false, dropped: [] });
  expect(window.segments.map((s) => s.id)).toEqual(['s3', 's4', 's5']);

  const same = readAlongWindow(window.segments, passageOf(5));
  expect(same.segments.map((s) => s.id)).toEqual(['s3', 's4', 's5']);

  const back = readAlongWindow(window.segments, passageOf(4));
  expect(back).toMatchObject({ reset: false, dropped: [] });
  expect(back.segments.map((s) => s.id)).toEqual(['s3', 's4']);

  const long = Array.from({ length: 8 }, (_, index) => passageOf(index + 10).current);
  const trimmed = readAlongWindow(long, passageOf(18), 8);
  expect(trimmed.dropped.map((s) => s.id)).toEqual(['s10']);
  expect(trimmed.segments).toHaveLength(8);
  expect(trimmed.segments[0].id).toBe('s11');

  const jump = readAlongWindow(window.segments, passageOf(40));
  expect(jump.reset).toBe(true);
  expect(jump.segments.map((s) => s.id)).toEqual(['s39', 's40']);
  const rewind = readAlongWindow(window.segments, passageOf(0));
  expect(rewind.reset).toBe(true);
});

function estimatedChunks(text: string) {
  return readAlongChunks({
    text,
    audio_start_ms: 0,
    audio_end_ms: 60000,
    word_timings: undefined,
  } as AlignmentSegment).map((chunk) => chunk.text);
}

test('phrases follow the sentence, not a fixed word count', () => {
  const kitchen =
    'I follow my nose to the kitchen, where Mags, Wiress, and Wyatt sit around the table, eating.';
  const fluffy =
    'The room has a strange, impersonal quality, has been decorated by someone whose taste runs to fluffy things and burnt orange.';
  // A sentence that fits stays whole, even at the length that used to be cut mid-thought.
  expect(estimatedChunks(fluffy)).toEqual([fluffy]);
  expect(estimatedChunks(`${fluffy} ${kitchen}`)).toEqual([fluffy, kitchen]);

  // Short sentences travel together until there is enough to read.
  expect(estimatedChunks('I nod. She smiles. We both wait for the train to arrive.')).toEqual([
    'I nod. She smiles. We both wait for the train to arrive.',
  ]);
});

test('a sentence that fits on screen is never cut, even with several commas', () => {
  const spreads =
    'She takes me to a room with two beds covered with fuzzy orange spreads, each with a pair of pajamas on it, and bids me good night.';
  expect(estimatedChunks(spreads)).toEqual([spreads]);
});

test('a sentence too long for one phrase is cut at a pause, never mid-phrase', () => {
  const long =
    'She walked along the old river path, past the mill and the broken bridge, and then turned toward the hills, where the shepherds kept their flocks through the long grey winter months, while the wind carried the smell of woodsmoke down from the valley, and the first stars came out over the far ridge.';
  const phrases = estimatedChunks(long);
  expect(phrases.join(' ')).toBe(long);
  expect(phrases.length).toBe(2);
  expect(phrases[0].endsWith(',')).toBe(true);
  expect(phrases.every((phrase) => phrase.split(' ').length >= 6)).toBe(true);

  const noCommas =
    'Alice walked through the garden and listened carefully to the curious story as the afternoon sunlight fell across the path and the flowers swayed gently beside her in the breeze while the old clock in the hall struck four and the kettle began to sing in the kitchen behind her';
  const [first, second] = estimatedChunks(noCommas);
  expect(`${first} ${second}`).toBe(noCommas);
  expect(second.split(' ')[0].toLowerCase()).toMatch(
    /^(and|as|while|that|when|where|which|who|whose|but|or|so|yet|because|if|though|although|then)$/,
  );
});
