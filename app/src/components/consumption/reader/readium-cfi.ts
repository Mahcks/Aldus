import type { Locator } from 'react-native-readium';

// Only text CFIs with one package-to-document indirection are supported.
// Native DOM resolution must still verify the exact anchor before accepting it.
const assertion = String.raw`\[(?:\^[\^[\](),;=]|[^\^[\]\r\n])*\]`;
const step = String.raw`/\d+(?:${assertion})?`;
const offset = String.raw`:\d+(?:${assertion})?`;
const path = String.raw`(?:${step})+(?:${offset})?`;
const relative = String.raw`(?:${step})*(?:${offset})?`;
const textCFI = new RegExp(
  String.raw`^epubcfi\((?:${step})+!${path}(?:,${relative},${relative})?\)$`,
);

function isResourceHref(href: string) {
  try {
    const decoded = decodeURIComponent(href);
    return (
      decoded.length > 0 &&
      !/^[a-z][a-z\d+.-]*:/i.test(decoded) &&
      !/[\\?#\u0000-\u001f\u007f]/.test(decoded) &&
      !decoded.startsWith('/') &&
      !decoded.split('/').some((part) => part === '..' || part === '.')
    );
  } catch {
    return false;
  }
}

export function parseSavedEPUBCFI(value: unknown): Locator | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { href, cfi } = value as { href?: unknown; cfi?: unknown };
  if (
    typeof href !== 'string' ||
    !isResourceHref(href) ||
    typeof cfi !== 'string' ||
    cfi.length > 16384 ||
    !textCFI.test(cfi)
  )
    return undefined;

  return {
    href: `${href}#${cfi}`,
    type: 'application/xhtml+xml',
    // Required by the bridge's Locator type; never used as a restore fallback.
    locations: { progression: 0 },
  };
}

export function savedEPUBCFI(locator: Locator): { href: string; cfi: string } | undefined {
  const separator = locator.href.indexOf('#');
  if (separator < 0) return undefined;
  const saved = {
    href: locator.href.slice(0, separator),
    cfi: locator.href.slice(separator + 1),
  };
  return parseSavedEPUBCFI(saved) ? saved : undefined;
}
