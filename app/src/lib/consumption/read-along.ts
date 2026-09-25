import type { AlignmentSegment } from '@/generated/api';
import { timedWords } from './offline-position';

export type ReadAlongChunk = {
  text: string;
  startMS: number;
  /** True when the start is estimated from text length rather than an exact word timing. */
  estimated: boolean;
};

/** Display-only chunks; segment IDs and canonical progress remain untouched. */
export function readAlongChunks(segment: AlignmentSegment): ReadAlongChunk[] {
  const text = segment.text.replace(/\s+/g, ' ').trim();
  const words = text.split(' ');
  const timings = timedWords(segment.word_timings, segment.audio_start_ms, segment.audio_end_ms);

  const comparable = (word: string) =>
    word
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  const exact =
    timings?.length === words.length &&
    words.every((word, index) => comparable(word) === comparable(timings[index].text));

  const chunks: ReadAlongChunk[] = [];
  let textOffset = 0;
  for (const { start, end } of chunkRanges(words)) {
    const chunkText = words.slice(start, end + 1).join(' ');
    // Display-only estimate for partial or absent word timings. Never use it
    // as a canonical position or a read/listen handoff target.
    const estimatedStart =
      segment.audio_start_ms +
      (textOffset / Math.max(1, text.length)) * (segment.audio_end_ms - segment.audio_start_ms);
    let startMS = segment.audio_start_ms;
    if (start > 0) startMS = exact ? timings![start].startTime * 1000 : estimatedStart;
    chunks.push({ text: chunkText, startMS, estimated: !exact });
    textOffset += chunkText.length + 1;
  }
  return chunks;
}

const MAX_WORDS = 40;
const MAX_CHARS = 260;
const MIN_WORDS = 6;
const SENTENCE_END = /[.!?…][”’"')\]]*$/;
const CLAUSE_END = /[,;:—–][”’"')\]]*$|[”’"')\]]$/;
const CLAUSE_START = new Set([
  'and',
  'but',
  'or',
  'so',
  'yet',
  'that',
  'which',
  'who',
  'whose',
  'when',
  'while',
  'because',
  'as',
  'if',
  'though',
  'although',
  'where',
  'then',
]);

type Range = { start: number; end: number };

function fits(words: string[], range: Range, slack = 0) {
  const count = range.end - range.start + 1;
  const characters = words.slice(range.start, range.end + 1).join(' ').length;
  return count <= MAX_WORDS + slack && characters <= MAX_CHARS + slack * 6;
}

/**
 * Where to cut a sentence that is too long for one phrase: at a comma, colon
 * or closing quote if one sits near the middle of the piece, otherwise just
 * before a word that starts a new clause ("and", "whose", …). Cutting at a
 * fixed word count would split "fluffy | things" mid-thought.
 */
function bestBreak(words: string[], start: number, end: number, ideal: number) {
  const low = Math.max(start + MIN_WORDS - 1, ideal - 5);
  const high = Math.min(end - MIN_WORDS, ideal + 5);
  if (low > high) return Math.min(Math.max(ideal, start + MIN_WORDS - 1), end - 1);

  const nearest = (matches: (position: number) => boolean) => {
    let best = -1;
    for (let position = low; position <= high; position++) {
      if (!matches(position)) continue;
      if (best < 0 || Math.abs(position - ideal) < Math.abs(best - ideal)) best = position;
    }
    return best;
  };
  const clause = nearest((position) => CLAUSE_END.test(words[position]));
  if (clause >= 0) return clause;
  const conjunction = nearest((position) =>
    CLAUSE_START.has(words[position + 1].toLowerCase().replace(/[^\p{L}]/gu, '')),
  );
  if (conjunction >= 0) return conjunction;
  return Math.min(Math.max(ideal, low), high);
}

function splitLong(words: string[], sentence: Range): Range[] {
  const count = sentence.end - sentence.start + 1;
  const characters = words.slice(sentence.start, sentence.end + 1).join(' ').length;
  // A long token cannot be split at a word boundary. Never ask for more
  // phrases than words, and reserve a word for each remaining phrase.
  const parts = Math.min(
    count,
    Math.max(2, Math.ceil(Math.max(count / MAX_WORDS, characters / MAX_CHARS))),
  );

  const ranges: Range[] = [];
  let start = sentence.start;
  for (let part = 1; part < parts; part++) {
    const ideal = sentence.start + Math.round((count * part) / parts) - 1;
    const cut = Math.min(
      sentence.end - (parts - part),
      Math.max(start, bestBreak(words, start, sentence.end, ideal)),
    );
    ranges.push({ start, end: cut });
    start = cut + 1;
  }
  ranges.push({ start, end: sentence.end });
  return ranges;
}

/**
 * Phrase boundaries: whole sentences where they fit, several short ones
 * together until there's enough to read, and long ones cut at natural pauses.
 */
function chunkRanges(words: string[]): Range[] {
  const sentences: Range[] = [];
  let sentenceStart = 0;
  words.forEach((word, index) => {
    if (SENTENCE_END.test(word) || index === words.length - 1) {
      sentences.push({ start: sentenceStart, end: index });
      sentenceStart = index + 1;
    }
  });

  const ranges: Range[] = [];
  let pending: Range | undefined;
  for (const sentence of sentences) {
    const pieces = fits(words, sentence) ? [sentence] : splitLong(words, sentence);
    for (const piece of pieces) {
      if (!pending) {
        pending = piece;
      } else if (fits(words, { start: pending.start, end: piece.end }, MIN_WORDS)) {
        pending = { start: pending.start, end: piece.end };
      } else {
        ranges.push(pending);
        pending = piece;
      }
      if (pending.end - pending.start + 1 >= MIN_WORDS) {
        ranges.push(pending);
        pending = undefined;
      }
    }
  }
  if (pending) ranges.push(pending);
  return ranges;
}

export function readAlongChunkIndex(chunks: ReadAlongChunk[], timestampMS: number) {
  const next = chunks.findIndex((chunk) => chunk.startMS > timestampMS);
  return next < 0 ? chunks.length - 1 : Math.max(0, next - 1);
}

type ReadAlongWindow = {
  segments: AlignmentSegment[];
  /** Segments that fell off the top; the caller keeps their height as spacer so nothing shifts. */
  dropped: AlignmentSegment[];
  /** True when the position jumped (seek, chapter change) and the window was rebuilt. */
  reset: boolean;
};

/**
 * The segments the read-along keeps on screen behind the narration. Playing
 * forward appends each new passage so text already read stays put above it;
 * a seek that lands outside what's kept rebuilds the window instead. Display
 * only: it never chooses a playback or progress position.
 */
export function readAlongWindow(
  history: AlignmentSegment[],
  passage: { previous?: AlignmentSegment; current: AlignmentSegment },
  limit = 8,
): ReadAlongWindow {
  const rebuilt = (): ReadAlongWindow => ({
    segments: [passage.previous, passage.current].filter((segment): segment is AlignmentSegment =>
      Boolean(segment),
    ),
    dropped: [],
    reset: true,
  });

  const last = history[history.length - 1];
  if (!last) return rebuilt();

  const known = history.findIndex((segment) => segment.id === passage.current.id);
  if (known >= 0) return { segments: history.slice(0, known + 1), dropped: [], reset: false };

  const gap = passage.current.ordinal - last.ordinal;
  if (gap < 1 || gap > 3) return rebuilt();

  const segments = [...history, passage.current];
  const overflow = Math.max(0, segments.length - limit);
  return {
    segments: segments.slice(overflow),
    dropped: segments.slice(0, overflow),
    reset: false,
  };
}
