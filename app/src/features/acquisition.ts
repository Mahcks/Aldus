import type { AcquisitionRequest, AcquisitionResult } from '@/generated/api';

export type AcquisitionFulfillment = {
  action?: 'review' | 'open';
  label: string;
  pending: boolean;
  tone: 'danger' | 'info' | 'success' | 'warning';
};

export function acquisitionFailureMessage(request: AcquisitionRequest) {
  const error = request.download_error?.trim();
  if (!error) return 'Aldus could not complete this request.';
  if (/qBittorrent|download client|magnet:\?|download torrent from indexer/i.test(error)) {
    return 'The download client did not accept this request. Check its connection and try again.';
  }
  return error;
}

export type AcquisitionResultGroup = {
  key: string;
  title: string;
  author?: string;
  match: 'exact' | 'related';
  releases: AcquisitionResult[];
};

/** Resolves only server-issued opposite-format pair IDs; it never infers sync eligibility. */
export function acquisitionCounterparts(
  result: AcquisitionResult,
  results: AcquisitionResult[],
): AcquisitionResult[] {
  if (result.match_confidence !== 'likely' || !result.likely_pair_ids?.length) return [];
  const ids = new Set(result.likely_pair_ids);
  return results.filter((candidate) => ids.has(candidate.id) && candidate.kind !== result.kind);
}

/** Groups server-normalized releases without inventing catalog identity on the client. */
export function groupAcquisitionResults(results: AcquisitionResult[]): AcquisitionResultGroup[] {
  const groups = new Map<string, AcquisitionResultGroup>();
  for (const result of results) {
    const key = result.group_key || result.id;
    const existing = groups.get(key);
    if (existing) {
      existing.releases.push(result);
      continue;
    }
    groups.set(key, {
      key,
      title: result.canonical_title || result.title,
      author: result.author,
      match: result.match,
      releases: [result],
    });
  }
  for (const group of groups.values()) {
    group.author ||= group.releases.find((release) => release.author)?.author;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.match !== b.match) return a.match === 'exact' ? -1 : 1;
    return (b.releases[0]?.relevance ?? 0) - (a.releases[0]?.relevance ?? 0);
  });
}

/** Turns the persisted server lifecycle into concise, truthful reader-facing state. */
export function acquisitionFulfillment(request: AcquisitionRequest): AcquisitionFulfillment | null {
  if (!request.selected_title) return null;
  if (request.download_error || request.fulfillment_state === 'failed') {
    return {
      label: request.download_state === 'ready' ? 'Import failed' : 'Download failed',
      tone: 'danger',
      pending: false,
    };
  }
  switch (request.fulfillment_state) {
    case 'scanning':
      return { label: 'Scanning', tone: 'info', pending: true };
    case 'needs_review':
      return { label: 'Needs review', tone: 'warning', pending: false, action: 'review' };
    case 'available':
      return { label: 'Available', tone: 'success', pending: false, action: 'open' };
    case 'downloading':
      return { label: 'Downloading', tone: 'info', pending: true };
    case 'awaiting_selection':
      return null;
    default:
      return request.download_state === 'ready'
        ? { label: 'Scanning', tone: 'info', pending: true }
        : { label: 'Downloading', tone: 'info', pending: true };
  }
}

export function acquisitionSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function acquisitionDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

/** Maps a release-title format token to the short badge label shown to users. */
const FORMAT_LABELS: Record<string, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  azw3: 'AZW3',
  pdf: 'PDF',
  cbz: 'CBZ',
  cbr: 'CBR',
  mp3: 'MP3',
  m4b: 'M4B',
  m4a: 'M4A',
  flac: 'FLAC',
  aac: 'AAC',
  ogg: 'OGG',
  opus: 'OPUS',
  wav: 'WAV',
  audiobook: 'Audiobook',
};

/** Release-metadata tokens stripped from a title once they've been read for their meaning. */
const METADATA_TOKENS = new Set([
  ...Object.keys(FORMAT_LABELS),
  'retail',
  'repack',
  'unabridged',
  'abridged',
  'narrated',
]);

export type ParsedAcquisitionRelease = {
  title: string;
  author?: string;
  format?: string;
};

function splitWords(value: string) {
  return value.split(/[\s._,[\]{}()]+/).filter(Boolean);
}

/** True for a short run of Capitalized words that reads like a person's name. */
function looksLikeAuthorName(value: string) {
  const words = splitWords(value);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][\p{L}.'-]*$/u.test(word));
}

function stripBracketedMetadata(value: string) {
  return value.replace(/[[({][^[\](){}]*[)\]}]/g, ' ');
}

function stripMetadataTokens(value: string) {
  return splitWords(value)
    .filter((word) => !METADATA_TOKENS.has(word.toLowerCase()))
    .join(' ');
}

function cleanTitle(value: string) {
  const withoutScope = stripBracketedMetadata(value)
    // Trailing scene-group tag attached directly to the release, e.g. "…EPUB-GROUP".
    // Unlike the spaced " - " author separator, this hyphen has no surrounding spaces.
    .replace(/-[A-Za-z0-9]+$/, '')
    .replace(/\b(19|20)\d{2}\b/g, ' ');
  return stripMetadataTokens(withoutScope)
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort parse of a raw torrent/indexer release title into a readable
 * title, an author (only when confidently detected), and a format badge.
 * Release naming is unstandardized, so absence of an author is expected and
 * fine — callers must not treat it as an error.
 */
export function parseAcquisitionRelease(rawTitle: string): ParsedAcquisitionRelease {
  const normalized = rawTitle.trim();
  const formatToken = splitWords(normalized).find((word) => FORMAT_LABELS[word.toLowerCase()]);
  const format = formatToken ? FORMAT_LABELS[formatToken.toLowerCase()] : undefined;

  // Keep dots/hyphens intact while hunting for author signals — collapsing
  // them first (as `cleanTitle` does) would destroy both the " - " author
  // separator and initials like "K." inside a matched name.
  let remainder = stripBracketedMetadata(normalized).trim();

  let author: string | undefined;
  const byMatch = /\bby\s+([A-Z][\p{L}.'-]*(?:\s+[A-Z][\p{L}.'-]*){0,3})\b/u.exec(remainder);
  if (byMatch) {
    author = byMatch[1].trim();
    remainder =
      remainder.slice(0, byMatch.index) + remainder.slice(byMatch.index + byMatch[0].length);
  } else {
    const dashIndex = normalized.indexOf(' - ');
    if (dashIndex > 0) {
      const candidate = normalized.slice(0, dashIndex).trim();
      if (looksLikeAuthorName(candidate)) {
        author = candidate;
        remainder = normalized.slice(dashIndex + 3);
      }
    }
  }

  return {
    title: cleanTitle(remainder) || cleanTitle(normalized) || normalized,
    author,
    format,
  };
}

function normalizeForRelevance(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phrases that mark a release as a derivative or tie-in work — companion
 * guides, cookbooks, craft books, study aids, tabletop tie-ins — rather than
 * the work itself. Indexers rank by seeders/date, not relevance, so without
 * this a query like "Lord of the Rings" surfaces a knitting book above the
 * actual novel.
 */
const DERIVATIVE_WORK_PHRASES = [
  'unofficial',
  'official companion',
  'companion',
  'cookbook',
  'recipes',
  'knitting',
  'knits',
  'coloring',
  'colouring',
  'cliffsnotes',
  'cliff notes',
  'study guide',
  'sparknotes',
  'philosophy',
  'strategy',
  'board game',
  'battle game',
  'trivia',
  'quiz',
  'explains',
  'discover the',
  'hidden meaning',
];

/**
 * Best-effort relevance score for ranking acquisition results against the
 * search query, highest first. Not a filter — a poor match still scores
 * lower rather than disappearing, since the heuristic can misfire.
 */
export function scoreAcquisitionRelevance(query: string, title: string): number {
  const normalizedQuery = normalizeForRelevance(query);
  const normalizedTitle = normalizeForRelevance(title);
  if (!normalizedQuery || !normalizedTitle) return 0;

  const queryWords = normalizedQuery.split(' ');
  const titleWords = normalizedTitle.split(' ');

  let score = 0;
  if (normalizedTitle === normalizedQuery) {
    score += 100;
  } else if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 60;
  } else if (normalizedTitle.includes(normalizedQuery)) {
    score += 30;
  } else {
    const queryWordSet = new Set(queryWords);
    const matched = titleWords.filter((word) => queryWordSet.has(word)).length;
    score += (matched / queryWords.length) * 20;
  }

  const extraWords = Math.max(0, titleWords.length - queryWords.length);
  score -= extraWords * 2;

  // Weighted well above the per-word penalty: a title with one derivative
  // marker and few extra words (e.g. a short study-guide title) must still
  // sink below a longer but otherwise-plain match, not win on brevity alone.
  let derivativeHits = 0;
  for (const phrase of DERIVATIVE_WORK_PHRASES) {
    if (normalizedTitle.includes(phrase)) derivativeHits += 1;
  }
  score -= derivativeHits * 45;

  return score;
}
