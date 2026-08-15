import type { AlignmentSegment, EPUBLocator } from '../../generated/api';
import type { Locator } from 'react-native-readium';

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

export function mapReadiumLocator(
  locator: Locator,
  segments: AlignmentSegment[],
): EPUBLocator | undefined {
  const href = normalizeHref(locator.href);
  const evidence = [locator.text?.highlight, locator.text?.after, locator.text?.before]
    .map((value) => normalize(value ?? ''))
    .filter((value) => value.length >= 24);
  const context = normalize(
    [locator.text?.before, locator.text?.highlight, locator.text?.after].filter(Boolean).join(' '),
  );
  if (context.length >= 24) evidence.push(context);
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

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
const normalizeHref = (value: string) =>
  decodeURIComponent(value).replace(/^\/+/, '').split('#')[0];
