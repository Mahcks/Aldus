export function activeContentIndex(visible: Range, contents: { doc: Document; index: number }[]) {
  return contents.find(({ doc }) => doc === visible.startContainer.ownerDocument)?.index;
}

export function currentParagraph(visible: Range) {
  const element =
    visible.startContainer.nodeType === 1
      ? (visible.startContainer as Element)
      : visible.startContainer.parentElement;
  const containing = element?.closest('p');
  if (containing && meaningful(containing)) return containing;
  const doc = visible.startContainer.ownerDocument;
  if (!doc) return null;
  for (const paragraph of doc.querySelectorAll('p')) {
    if (meaningful(paragraph) && visible.intersectsNode(paragraph)) return paragraph;
  }
  return null;
}

export function classifyPageSync(aligned: number, unresolved: number) {
  return aligned === 0
    ? ('none' as const)
    : unresolved > 0
      ? ('partial' as const)
      : ('full' as const);
}

export function relocatedCursor<T extends { href: string }>(
  committed: T | undefined,
  fallback: T | undefined,
  href: string,
) {
  return committed?.href === href ? committed : fallback;
}

export function relocationCursor<T extends { href: string }>(
  committed: T | undefined,
  visible: T | undefined,
  href: string,
  commit: boolean,
) {
  return commit ? visible : relocatedCursor(committed, visible, href);
}

export function commitsReadingProgress(reason?: string) {
  return reason === 'forward' || reason === 'explicit';
}

export function commitsFoliateRelocation(
  reason: string | undefined,
  initialized: boolean,
  direction: 'initial' | 'forward' | 'backward',
) {
  return (
    initialized &&
    (direction !== 'initial' || reason == null || ['page', 'scroll', 'snap'].includes(reason))
  );
}

export function directionAfterRelocation(
  direction: 'initial' | 'forward' | 'backward',
  hasVisibleSegment: boolean,
) {
  return hasVisibleSegment ? ('initial' as const) : direction;
}

export function segmentRangeMode(locator: { dom_path?: string; start?: unknown; end?: unknown }) {
  if (!locator.dom_path) return;
  return locator.start && locator.end ? ('boundaries' as const) : ('element' as const);
}

export function disposeReaderView(view?: { close?: () => void; remove?: () => void }) {
  try {
    view?.close?.();
  } finally {
    view?.remove?.();
  }
}

export function deferredDisposal(dispose: () => void) {
  let requested = false;
  let settled = false;
  let disposed = false;
  const run = () => {
    if (!requested || !settled || disposed) return;
    disposed = true;
    dispose();
  };
  return {
    request() {
      requested = true;
      run();
    },
    settle() {
      settled = true;
      run();
    },
    fail() {
      requested = true;
      settled = true;
      run();
    },
  };
}

export function initializeReaderView(view: {
  init: (options: { showTextStart: boolean }) => Promise<void>;
}) {
  return view.init({ showTextStart: true });
}

const meaningful = (element: Element) => Boolean(element.textContent?.replace(/\s+/g, ' ').trim());
