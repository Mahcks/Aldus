import type { AlignmentSegment, EPUBLocator } from '@/generated/api';
import type { DecorationGroup, Locator } from 'react-native-readium';
import { canonicalTextOffset, utf16IndexAtCanonicalOffset } from '@/components/reader-location';

export function parseReadiumLocator(value: unknown): Locator | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const locator = value as Partial<Locator>;
  const progression = locator.locations?.progression;
  if (
    typeof locator.href !== 'string' ||
    !locator.href ||
    typeof locator.type !== 'string' ||
    !locator.type ||
    typeof progression !== 'number' ||
    !Number.isFinite(progression) ||
    progression < 0 ||
    progression > 1
  )
    return undefined;
  for (const text of [locator.text?.before, locator.text?.highlight, locator.text?.after]) {
    if (text != null && typeof text !== 'string') return undefined;
  }
  return locator as Locator;
}

export function serializeReadiumLocator(locator: Locator) {
  return JSON.stringify(locator);
}

export function deserializeReadiumLocator(value?: string) {
  if (!value) return undefined;
  try {
    return parseReadiumLocator(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function preferredReadiumLocator(locator: Locator, visible?: Locator) {
  return visible && normalizeHref(visible.href) === normalizeHref(locator.href) ? visible : locator;
}

export function readiumResumeDecorations(locator: Locator, highlight: boolean, tint: string) {
  if (!highlight) return [];
  return [
    {
      name: 'resume-position',
      decorations: [
        {
          id: 'resume-position',
          locator,
          style: { type: 'highlight', tint },
        },
      ],
    },
  ] satisfies DecorationGroup[];
}

export function mapReadiumLocator(
  locator: Locator,
  segments: AlignmentSegment[],
): EPUBLocator | undefined {
  const precise = mapReadiumSelection(locator, locator.text?.highlight ?? '', segments);
  if (precise) return precise;
  const href = normalizeHref(locator.href);
  const evidence = [locator.text?.highlight, locator.text?.after, locator.text?.before]
    .map((value) => normalize(value ?? ''))
    .filter((value) => value.length >= 16);
  const context = normalize(
    [locator.text?.before, locator.text?.highlight, locator.text?.after].filter(Boolean).join(' '),
  );
  if (context.length >= 16) evidence.push(context);
  if (!evidence.length) return undefined;
  const matches = segments.filter(
    (segment) =>
      segment.highlightable &&
      normalizeHref(segment.epub_href) === href &&
      evidence.some((fragment) => {
        const text = normalize(segment.text);
        return fragment.includes(text) || text.includes(fragment);
      }),
  );
  if (matches.length !== 1) return undefined;
  return { href: matches[0].epub_href, locator: matches[0].epub_locator, offset: 0 };
}

export function readiumLocationReason(
  direction: 'forward' | 'backward' | undefined,
  progression: number | undefined,
  previousProgression: number | undefined,
  hasCanonicalLocation: boolean,
) {
  if (!hasCanonicalLocation) return { reason: 'relocate' as const, pendingDirection: direction };
  if (direction === 'forward') return { reason: 'forward' as const, pendingDirection: undefined };
  if (direction === 'backward') return { reason: 'explicit' as const, pendingDirection: undefined };
  if (progression != null && previousProgression != null && progression !== previousProgression)
    return {
      reason: progression > previousProgression ? ('forward' as const) : ('explicit' as const),
      pendingDirection: undefined,
    };
  return { reason: 'relocate' as const, pendingDirection: undefined };
}

export function mapReadiumSelection(
  locator: Locator,
  selectedText: string,
  segments: AlignmentSegment[],
): EPUBLocator | undefined {
  const href = normalizeHref(locator.href);
  const selected = fold(selectedText || locator.text?.highlight || '');
  const before = fold(locator.text?.before ?? '');
  const after = fold(locator.text?.after ?? '');
  if (!selected) return undefined;
  const matches = segments.flatMap((segment) => {
    if (!segment.highlightable || normalizeHref(segment.epub_href) !== href) return [];
    const text = fold(segment.text);
    const match = selectionMatch(text, selected, before, after);
    if (match.indexes.length !== 1) return [];
    return [
      {
        segment,
        offset: canonicalTextOffset(text.slice(0, match.indexes[0]), text),
        contextual: match.contextual,
      },
    ];
  });
  const resolved = matches.some((match) => match.contextual)
    ? matches.filter((match) => match.contextual)
    : matches;
  if (resolved.length === 1)
    return {
      href: resolved[0].segment.epub_href,
      locator: resolved[0].segment.epub_locator,
      offset: Math.min(1_000_000, resolved[0].offset),
    };
  return undefined;
}

export function readiumSearchQuery(segment: AlignmentSegment, offset: number) {
  const text = fold(segment.text);
  const target = utf16IndexAtCanonicalOffset(text, offset);
  const words = [...text.matchAll(/\S+/g)];
  const index = Math.max(
    0,
    words.findIndex((word) => (word.index ?? 0) + word[0].length >= target),
  );
  return words
    .slice(index, index + 8)
    .map((word) => word[0])
    .join(' ');
}

export function readiumSearchQueries(
  segment: AlignmentSegment,
  offset: number,
  segments: AlignmentSegment[],
) {
  const phrase = readiumSearchQuery(segment, offset);
  const text = fold(segment.text);
  const target = utf16IndexAtCanonicalOffset(text, offset);
  const uniqueWords = [...text.matchAll(/[\p{L}\p{N}]+/gu)]
    .sort(
      (left, right) => Math.abs((left.index ?? 0) - target) - Math.abs((right.index ?? 0) - target),
    )
    .map((match) => match[0])
    .filter(
      (word) =>
        word.length >= 5 &&
        segments.reduce((count, item) => count + wordOccurrences(item.text, word), 0) === 1,
    )
    .filter((word, index, words) => words.indexOf(word) === index)
    .slice(0, 8);
  return [phrase, ...uniqueWords];
}

export function segmentForEPUBLocator(target: EPUBLocator, segments: AlignmentSegment[]) {
  const locator = JSON.stringify(target.locator);
  const matches = segments.filter(
    (segment) =>
      segment.highlightable &&
      normalizeHref(segment.epub_href) === normalizeHref(target.href) &&
      JSON.stringify(segment.epub_locator) === locator,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function readiumRestoreDisposition(target: EPUBLocator | undefined, href: string) {
  if (!target) return 'publish' as const;
  return normalizeHref(target.href) === normalizeHref(href)
    ? ('restore' as const)
    : ('suppress' as const);
}

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const fold = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
function selectionMatch(text: string, selected: string, before: string, after: string) {
  for (const window of [80, 40, 20, 8]) {
    const anchors = [
      joinText(before.slice(-window), selected),
      joinText(selected, after.slice(0, window)),
    ];
    for (const anchor of anchors) {
      const indexes = occurrences(text, anchor).map((index) =>
        anchor.startsWith(selected) ? index : index + anchor.length - selected.length,
      );
      if (indexes.length === 1) return { indexes, contextual: true };
    }
  }
  return { indexes: occurrences(text, selected), contextual: false };
}
function joinText(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  return /^[\p{P}\p{S}]/u.test(right) ? `${left}${right}` : `${left} ${right}`;
}
function occurrences(text: string, query: string) {
  const indexes: number[] = [];
  for (let index = text.indexOf(query); index >= 0; index = text.indexOf(query, index + 1))
    indexes.push(index);
  return indexes;
}
function wordOccurrences(text: string, query: string) {
  const words =
    text
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const target = query.normalize('NFKC').toLocaleLowerCase();
  return words.filter((word) => word === target).length;
}
const normalizeHref = (value: string) => {
  try {
    return decodeURIComponent(value).replace(/^\/+/, '').split('#')[0];
  } catch {
    return value.replace(/^\/+/, '').split('#')[0];
  }
};
