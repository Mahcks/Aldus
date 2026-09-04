import { Asset } from 'expo-asset';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View as RNView } from 'react-native';
import { IconButton } from '@/features/ui';
import { colors } from '@/features/theme';
import { flattenReaderContents } from '@/features/reader-navigation';
import { Text, View } from '@/features/tw';
import {
  activeContentIndex,
  canonicalTextOffset,
  classifyPageSync,
  commitsFoliateRelocation,
  directionAfterRelocation,
  deferredDisposal,
  disposeReaderView,
  initializeReaderView,
  relocationCursor,
  segmentRangeMode,
} from './reader-location';
import { installEPUBContentSecurity } from './epub-security';

const openDyslexicURL = Asset.fromModule(
  // Metro resolves bundled font assets through its static CommonJS lookup.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2'),
).uri;

export type RangeBoundary = { dom_path: string; node_offset: number };
export type ReaderCapture = {
  href: string;
  cfi: string;
  text: string;
  normalized_text: string;
  start: RangeBoundary;
  end: RangeBoundary;
};
export type ReaderLocation = {
  href: string;
  cfi: string;
  sync?: {
    href: string;
    locator: { type: 'dom-element'; dom_path: string; segment_id: string };
    offset: number;
  };
  syncState?: 'full' | 'partial' | 'none';
  reason?: 'relocate' | 'forward' | 'explicit' | 'restore';
};
export type EPUBReaderHandle = {
  captureSelection: () => ReaderCapture | null;
  restoreSelection: (capture: ReaderCapture) => Promise<string>;
  restoreLocation: (location: unknown, highlight?: boolean) => Promise<boolean>;
  navigate: (location: unknown) => Promise<boolean>;
  search: (query: string) => Promise<ReaderSearchResult[]>;
};
export type ReaderNavigationItem = { title: string; location: unknown; depth: number };
export type ReaderSearchResult = { title: string; excerpt: string; location: unknown };
export type ReaderPreferences = {
  layout: 'paginated' | 'scrolled';
  zoom: number;
  lineHeight: number;
  margin: number;
  theme: 'paper' | 'sepia' | 'night';
  fontFamily: 'publisher' | 'serif' | 'sans' | 'dyslexic';
};
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  layout: 'paginated',
  zoom: 1,
  lineHeight: 1.72,
  margin: 2,
  theme: 'paper',
  fontFamily: 'serif',
};

type Props = {
  source?: string | Blob;
  product?: boolean;
  segments?: SyncSegment[];
  preferences?: ReaderPreferences;
  compactChrome?: boolean;
  statusLabel?: string;
  onLocation?: (location: ReaderLocation) => void;
  onListenFromLocation?: (location: ReaderLocation) => void;
  onReady?: (contents: ReaderNavigationItem[]) => void;
  onError?: (error: Error) => void;
};
type SyncSegment = {
  id: string;
  ordinal: number;
  epub_href: string;
  epub_locator: unknown;
  highlightable: boolean;
};

export const EPUBReader = forwardRef<EPUBReaderHandle, Props>(function EPUBReader(
  {
    source = '/media/alice.epub',
    product,
    segments = [],
    preferences = DEFAULT_READER_PREFERENCES,
    compactChrome,
    statusLabel,
    onLocation,
    onReady,
    onError,
  },
  ref,
) {
  const [ready, setReady] = useState(false);
  const host = useRef<RNView>(null);
  const reader = useRef<any>(null);
  const disposalRef = useRef<ReturnType<typeof deferredDisposal>>(null);
  const selection = useRef<{ index: number; range: Range } | undefined>(undefined);
  const cursor = useRef<ReaderLocation>(undefined);
  const page = useRef<{
    href: string;
    cfi: string;
    range: Range;
    state: ReaderLocation['syncState'];
  }>(undefined);
  const direction = useRef<'initial' | 'forward' | 'backward'>('initial');
  const relocated = useRef(false);
  const onLocationRef = useRef(onLocation);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const segmentsRef = useRef(segments);
  const preferencesRef = useRef(preferences);
  onLocationRef.current = onLocation;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  segmentsRef.current = segments;
  preferencesRef.current = preferences;

  useEffect(() => {
    const view = reader.current;
    if (!view) return;
    view.renderer.setAttribute('flow', preferences.layout);
    for (const { doc } of view.renderer.getContents()) applyReaderStyles(doc, preferences);
  }, [preferences]);

  useImperativeHandle(
    ref,
    () => ({
      captureSelection() {
        const current = selection.current;
        if (!current || current.range.collapsed || !current.range.toString()) return null;
        return serializeRange(reader.current, current.index, current.range);
      },
      async restoreSelection(capture) {
        const view = reader.current;
        const disposal = disposalRef.current;
        if (!view || !disposal) throw new Error('The reader is no longer open.');
        const target = capture.cfi || capture.href;
        const operation = disposal.track(async () => {
          const resolved = await view.resolveNavigation(target);
          await view.goTo(target);
          const content = view.renderer
            .getContents()
            .find(({ index }: { index: number }) => index === resolved.index);
          const range = capture.cfi
            ? (resolved.anchor(content.doc) as Range)
            : restoreDOMRange(content.doc, capture);
          const selected = content.doc.getSelection();
          selected?.removeAllRanges();
          selected?.addRange(range);
          selection.current = { index: resolved.index, range: range.cloneRange() };
          return range.toString();
        });
        if (!operation) throw new Error('The reader is closing.');
        return operation;
      },
      async navigate(location) {
        const view = reader.current;
        const disposal = disposalRef.current;
        if (!view || !disposal || (!location && location !== 0)) return false;
        direction.current = 'forward';
        return (
          (await disposal.track(async () => {
            await view.goTo(location);
            return true;
          })) ?? false
        );
      },
      async search(query) {
        const view = reader.current;
        const disposal = disposalRef.current;
        if (!view || !disposal || !query.trim()) return [];
        return (
          (await disposal.track(async () => {
            const results: ReaderSearchResult[] = [];
            try {
              for await (const result of view.search({ query: query.trim() })) {
                if (result === 'done' || results.length >= 100) break;
                for (const item of result.subitems ?? []) {
                  results.push({
                    title: result.label || 'Search result',
                    excerpt: [item.excerpt?.pre, item.excerpt?.match, item.excerpt?.post]
                      .filter(Boolean)
                      .join(''),
                    location: item.cfi,
                  });
                  if (results.length >= 100) break;
                }
              }
              return results;
            } finally {
              view.clearSearch();
            }
          })) ?? []
        );
      },
      async restoreLocation(value, highlight = false) {
        const view = reader.current;
        const disposal = disposalRef.current;
        if (!view || !disposal || !value || typeof value !== 'object') return false;
        const location = value as {
          href?: string;
          cfi?: string;
          offset?: number;
          locator?: {
            type?: string;
            dom_path?: string;
            segment_id?: string;
            start?: RangeBoundary;
            end?: RangeBoundary;
          };
        };
        if (location.cfi)
          return (
            (await disposal.track(async () => {
              await view.goTo(location.cfi);
              return true;
            })) ?? false
          );
        if (
          !location.href ||
          location.locator?.type !== 'dom-element' ||
          !location.locator.dom_path
        )
          return false;
        if (location.locator.segment_id)
          cursor.current = {
            href: location.href,
            cfi: '',
            sync: {
              href: location.href,
              locator: {
                type: 'dom-element',
                dom_path: location.locator.dom_path,
                segment_id: location.locator.segment_id,
              },
              offset: location.offset ?? 0,
            },
            reason: 'restore',
          };
        return (
          (await disposal.track(async () => {
            const resolved = await view.resolveNavigation(location.href);
            await view.goTo(location.href);
            const content = view.renderer
              .getContents()
              .find(({ index }: { index: number }) => index === resolved.index);
            const element = resolveDOMPath(content.doc, location.locator!.dom_path!);
            const range = content.doc.createRange();
            if (location.locator!.start && location.locator!.end) {
              range.setStart(
                resolveDOMPath(content.doc, location.locator!.start!.dom_path),
                location.locator!.start!.node_offset,
              );
              range.setEnd(
                resolveDOMPath(content.doc, location.locator!.end!.dom_path),
                location.locator!.end!.node_offset,
              );
            } else range.selectNodeContents(element);
            const cfi = view.getCFI(resolved.index, range);
            await view.goTo(cfi);
            if (highlight) {
              const selected = content.doc.getSelection();
              selected?.removeAllRanges();
              selected?.addRange(range);
            }
            if (!disposal.requested() && cursor.current)
              onLocationRef.current?.({
                ...cursor.current,
                cfi,
                syncState: page.current?.state,
                reason: 'restore',
              });
            return true;
          })) ?? false
        );
      },
    }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let view: any;
    const disposal = deferredDisposal(() => disposeReaderView(view));
    disposalRef.current = disposal;
    cursor.current = undefined;
    page.current = undefined;
    direction.current = 'initial';
    relocated.current = false;
    setReady(false);
    void import('foliate-js/view.js')
      .then(async () => {
        if (disposed || !host.current) return;
        view = document.createElement('foliate-view') as any;
        view.style.width = '100%';
        view.style.height = product ? 'calc(100vh - 238px)' : '65vh';
        (host.current as unknown as HTMLElement).append(view);
        view.addEventListener('load', ({ detail: { doc, index } }: CustomEvent) => {
          if (disposed) return;
          if (product) {
            applyReaderStyles(doc, preferencesRef.current);
          }
          doc.addEventListener('selectionchange', () => {
            if (disposed) return;
            const selected = doc.getSelection();
            if (selected?.rangeCount && !selected.isCollapsed)
              selection.current = { index, range: selected.getRangeAt(0).cloneRange() };
          });
          doc.addEventListener('click', (event: MouseEvent) => {
            if (disposed || !product) return;
            const point = caretAt(doc, event.clientX, event.clientY);
            const href = view.book.sections[index]?.id;
            const current = page.current;
            if (!point || !href || !current) return;
            const match = containingSegment(point, href, segmentsRef.current);
            if (!match)
              return onLocationRef.current?.({
                href,
                cfi: current.cfi,
                syncState: current.state,
                reason: 'explicit',
              });
            cursor.current = syncLocation(href, current.cfi, match, current.state, 'explicit');
            if (__DEV__)
              console.debug('Aldus reading cursor', {
                reason: 'explicit',
                href,
                boundary: boundary(point),
                segment_id: match.id,
                offset: match.offset,
              });
            onLocationRef.current?.(cursor.current);
          });
        });
        view.addEventListener('relocate', ({ detail }: CustomEvent) => {
          if (disposed) return;
          const range = detail.range as Range | undefined;
          const index = range ? activeContentIndex(range, view.renderer.getContents()) : undefined;
          if (!range || index == null) return;
          const href = view.book.sections[index]?.id;
          if (!href) return;
          const state = pageSyncState(range, href, segmentsRef.current);
          page.current = { href, cfi: detail.cfi, range: range.cloneRange(), state };
          const navigationDirection = direction.current;
          const visible =
            containingSegment(range, href, segmentsRef.current) ??
            leadingSegment(range, href, segmentsRef.current);
          const commit =
            Boolean(visible) &&
            commitsFoliateRelocation(detail.reason, relocated.current, navigationDirection);
          if (visible) relocated.current = true;
          direction.current = directionAfterRelocation(navigationDirection, Boolean(visible));
          const reason = commit ? 'explicit' : 'relocate';
          const visibleLocation = visible
            ? syncLocation(href, detail.cfi, visible, state, reason)
            : undefined;
          cursor.current = relocationCursor(cursor.current, visibleLocation, href, commit);
          const location: ReaderLocation = cursor.current
            ? { ...cursor.current, cfi: detail.cfi, syncState: state, reason }
            : { href, cfi: detail.cfi, syncState: state, reason };
          if (__DEV__)
            console.debug('Aldus relocation', {
              href,
              visible_start: boundary(range),
              visible_end: boundary(range, true),
              direction: navigationDirection,
              cursor: cursor.current?.sync,
              candidate_segments: intersectingSegments(range, href, segmentsRef.current).map(
                (item) => item.id,
              ),
              sync_state: state,
              listen: cursor.current?.sync
                ? 'enabled: valid cursor'
                : state === 'partial'
                  ? 'disabled: move to aligned text'
                  : 'disabled: no valid cursor',
            });
          onLocationRef.current?.(location);
        });
        await view.open(
          source instanceof Blob
            ? new File([source], 'book.epub', { type: 'application/epub+zip' })
            : source,
        );
        installEPUBContentSecurity(view.book);
        await initializeReaderView(view);
        disposal.settle();
        if (disposed) {
          return;
        }
        view.renderer.setAttribute('flow', preferencesRef.current.layout);
        reader.current = view;
        setReady(true);
        onReadyRef.current?.(
          flattenReaderContents(view.book.toc ?? []).map((item) => ({
            title: item.title,
            location: item.href,
            depth: item.depth,
          })),
        );
      })
      .catch((error: unknown) => {
        disposal.fail();
        if (!disposed)
          onErrorRef.current?.(
            error instanceof Error ? error : new Error('The EPUB could not be opened.'),
          );
      });
    return () => {
      disposed = true;
      disposal.request();
      if (disposalRef.current === disposal) disposalRef.current = null;
      if (reader.current === view) reader.current = null;
    };
  }, [source, product]);

  return (
    <View className="relative min-h-[560px] flex-1">
      <RNView ref={host} style={styles.book} />
      {!ready ? (
        <View className="absolute inset-0 items-center justify-center gap-3 bg-paper">
          <ActivityIndicator color={colors.accent} />
          <Text className="text-sm text-muted">Opening EPUB…</Text>
        </View>
      ) : null}
      {compactChrome || preferences.layout !== 'scrolled' ? (
        <View className="min-h-12 shrink-0 flex-row items-center justify-between border-t border-line bg-paper px-2">
          <IconButton
            icon="previousPage"
            label="Previous page"
            kind="quiet"
            onPress={() => {
              const view = reader.current;
              const disposal = disposalRef.current;
              if (!view || !disposal) return;
              const operation = disposal.track(() => Promise.resolve(view.goLeft()));
              if (operation) {
                direction.current = 'backward';
                void operation.catch((error: unknown) => {
                  if (!disposal.requested())
                    onErrorRef.current?.(
                      error instanceof Error ? error : new Error('The page could not be opened.'),
                    );
                });
              }
            }}
          />
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              statusLabel ? `Synchronization status: ${statusLabel}` : 'Page navigation'
            }
            numberOfLines={1}
            className="flex-shrink text-center text-xs text-muted"
          >
            {statusLabel ??
              (product
                ? 'Your place is saved as you turn pages.'
                : 'Highlight a passage in Alice, then click Capture selection.')}
          </Text>
          <IconButton
            icon="nextPage"
            label="Next page"
            kind="quiet"
            onPress={() => {
              const view = reader.current;
              const disposal = disposalRef.current;
              if (!view || !disposal) return;
              const operation = disposal.track(() => Promise.resolve(view.goRight()));
              if (operation) {
                direction.current = 'forward';
                void operation.catch((error: unknown) => {
                  if (!disposal.requested())
                    onErrorRef.current?.(
                      error instanceof Error ? error : new Error('The page could not be opened.'),
                    );
                });
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
});

function containingSegment(point: Range, href: string, segments: SyncSegment[]) {
  for (const segment of segments) {
    const locator = segment.epub_locator as {
      dom_path?: string;
      start?: RangeBoundary;
      end?: RangeBoundary;
    };
    if (!segment.highlightable || segment.epub_href !== href || !locator?.dom_path) continue;
    try {
      const doc = point.startContainer.ownerDocument!;
      const range = segmentRange(doc, locator);
      if (
        range.comparePoint(point.startContainer, point.startOffset) !== 0 ||
        (locator.end && sameBoundary(point, locator.end, doc))
      )
        continue;
      const before = range.cloneRange();
      before.setEnd(point.startContainer, point.startOffset);
      return {
        id: segment.id,
        domPath: locator.dom_path,
        offset: canonicalTextOffset(normalize(before.toString()), normalize(range.toString())),
      };
    } catch {
      /* malformed boundaries fail closed */
    }
  }
}

function intersectingSegments(visible: Range, href: string, segments: SyncSegment[]) {
  return segments.filter((segment) => {
    if (segment.epub_href !== href) return false;
    const locator = segment.epub_locator as {
      dom_path?: string;
      start?: RangeBoundary;
      end?: RangeBoundary;
    };
    if (!locator?.dom_path) return false;
    try {
      const doc = visible.startContainer.ownerDocument!;
      const range = segmentRange(doc, locator);
      return (
        comparePoints(
          range.startContainer,
          range.startOffset,
          visible.endContainer,
          visible.endOffset,
          doc,
        ) < 0 &&
        comparePoints(
          range.endContainer,
          range.endOffset,
          visible.startContainer,
          visible.startOffset,
          doc,
        ) > 0
      );
    } catch {
      return false;
    }
  });
}

function pageSyncState(
  visible: Range,
  href: string,
  segments: SyncSegment[],
): ReaderLocation['syncState'] {
  const candidates = intersectingSegments(visible, href, segments);
  return classifyPageSync(
    candidates.filter((segment) => segment.highlightable).length,
    candidates.filter((segment) => !segment.highlightable).length,
  );
}

function leadingSegment(visible: Range, href: string, segments: SyncSegment[]) {
  const segment = intersectingSegments(visible, href, segments)
    .filter((candidate) => candidate.highlightable)
    .sort((a, b) => a.ordinal - b.ordinal)[0];
  const locator = segment?.epub_locator as { dom_path?: string } | undefined;
  if (!segment || !locator?.dom_path) return;
  return { id: segment.id, domPath: locator.dom_path, offset: 0 };
}

function syncLocation(
  href: string,
  cfi: string,
  match: { id: string; domPath: string; offset: number },
  syncState: ReaderLocation['syncState'],
  reason: ReaderLocation['reason'],
): ReaderLocation {
  return {
    href,
    cfi,
    sync: {
      href,
      locator: { type: 'dom-element', dom_path: match.domPath, segment_id: match.id },
      offset: match.offset,
    },
    syncState,
    reason,
  };
}

function segmentRange(
  doc: Document,
  locator: { dom_path?: string; start?: RangeBoundary; end?: RangeBoundary },
) {
  const range = doc.createRange();
  const mode = segmentRangeMode(locator);
  if (mode === 'boundaries') {
    range.setStart(resolveDOMPath(doc, locator.start!.dom_path), locator.start!.node_offset);
    range.setEnd(resolveDOMPath(doc, locator.end!.dom_path), locator.end!.node_offset);
  } else if (mode === 'element') {
    range.selectNodeContents(resolveDOMPath(doc, locator.dom_path!));
  } else throw new Error('Missing segment locator');
  return range;
}

function comparePoints(aNode: Node, aOffset: number, bNode: Node, bOffset: number, doc: Document) {
  const a = doc.createRange();
  a.setStart(aNode, aOffset);
  a.collapse(true);
  const b = doc.createRange();
  b.setStart(bNode, bOffset);
  b.collapse(true);
  return a.compareBoundaryPoints(Range.START_TO_START, b);
}

function sameBoundary(visible: Range, boundary: RangeBoundary, doc: Document, end = false) {
  const point = doc.createRange();
  point.setStart(resolveDOMPath(doc, boundary.dom_path), boundary.node_offset);
  point.collapse(true);
  const current = doc.createRange();
  current.setStart(
    end ? visible.endContainer : visible.startContainer,
    end ? visible.endOffset : visible.startOffset,
  );
  current.collapse(true);
  return current.compareBoundaryPoints(Range.START_TO_START, point) === 0;
}

function caretAt(doc: Document, x: number, y: number) {
  const modern = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint?.(x, y);
  const legacy = (
    doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.(x, y);
  if (legacy) return legacy;
  if (!modern) return null;
  const range = doc.createRange();
  range.setStart(modern.offsetNode, modern.offset);
  range.collapse(true);
  return range;
}

function boundary(range: Range, end = false) {
  const node = end ? range.endContainer : range.startContainer;
  const offset = end ? range.endOffset : range.startOffset;
  return { dom_path: domPath(node), node_offset: offset };
}

function applyReaderStyles(doc: Document, preferences: ReaderPreferences) {
  const style =
    doc.querySelector<HTMLStyleElement>('#aldus-reader-style') ??
    doc.head.appendChild(doc.createElement('style'));
  style.id = 'aldus-reader-style';
  const night = preferences.theme === 'night';
  const background = night
    ? colors.readerNightPaper
    : preferences.theme === 'sepia'
      ? colors.canvas
      : colors.paper;
  const ink = night ? colors.readerNightInk : colors.ink;
  const selection = night ? colors.readerNightSelection : colors.accentSoft;
  const fontFamily =
    preferences.fontFamily === 'publisher'
      ? ''
      : preferences.fontFamily === 'sans'
        ? "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"
        : preferences.fontFamily === 'dyslexic'
          ? "font-family: 'OpenDyslexic', sans-serif;"
          : "font-family: Georgia, 'Times New Roman', serif;";
  const fontFace =
    preferences.fontFamily === 'dyslexic'
      ? `@font-face { font-family: 'OpenDyslexic'; src: url('${openDyslexicURL}') format('woff2'); font-style: normal; font-weight: 400; font-display: swap; }`
      : '';
  style.textContent = `${fontFace} html { color: ${ink}; background: ${background}; } body { ${fontFamily} font-size: ${1.08 * preferences.zoom}rem; line-height: ${preferences.lineHeight}; padding-inline: clamp(1rem, 4vw, ${preferences.margin + 1.5}rem); } p { max-width: 68ch; margin-inline: auto; text-align: start; } a { color: inherit; } ::selection { background: ${selection}; color: ${ink}; }`;
}

function serializeRange(view: any, index: number, range: Range): ReaderCapture {
  const text = range.toString();
  return {
    href: view.book.sections[index].id,
    cfi: view.getCFI(index, range),
    text,
    normalized_text: normalize(text),
    start: { dom_path: domPath(range.startContainer), node_offset: range.startOffset },
    end: { dom_path: domPath(range.endContainer), node_offset: range.endOffset },
  };
}

function normalize(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function restoreDOMRange(doc: Document, capture: ReaderCapture) {
  const range = doc.createRange();
  range.setStart(resolveDOMPath(doc, capture.start.dom_path), capture.start.node_offset);
  range.setEnd(resolveDOMPath(doc, capture.end.dom_path), capture.end.node_offset);
  return range;
}

function resolveDOMPath(doc: Document, path: string) {
  let node: Node = doc;
  for (const part of path.split('/')) {
    const match = /^(\w+|text\(\))\[(\d+)\]$/.exec(part);
    if (!match) throw new Error(`Invalid DOM path: ${path}`);
    const [, name, rawIndex] = match;
    const candidates =
      name === 'text()'
        ? Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE)
        : Array.from(node.childNodes).filter(
            (child) =>
              child.nodeType === Node.ELEMENT_NODE &&
              (child as Element).tagName.toLowerCase() === name,
          );
    node = candidates[Number(rawIndex) - 1];
    if (!node) throw new Error(`DOM path not found: ${path}`);
  }
  return node;
}

function domPath(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const siblings = Array.from(node.parentNode?.childNodes ?? []).filter(
      (sibling) => sibling.nodeType === Node.TEXT_NODE,
    );
    return `${domPath(node.parentNode!)}/text()[${siblings.indexOf(node as ChildNode) + 1}]`;
  }
  const element = node as Element;
  if (element.tagName?.toLowerCase() === 'html') return 'html[1]';
  const parent = element.parentElement;
  const tag = element.tagName.toLowerCase();
  const siblings = Array.from(parent?.children ?? []).filter(
    (sibling) => sibling.tagName === element.tagName,
  );
  return `${domPath(parent!)}/${tag}[${siblings.indexOf(element) + 1}]`;
}

const styles = StyleSheet.create({
  book: { flex: 1, minHeight: 500, overflow: 'hidden', backgroundColor: colors.paper },
});
