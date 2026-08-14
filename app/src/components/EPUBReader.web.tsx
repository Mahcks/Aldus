import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from '../features/ui';
import { colors } from '../features/theme';
import { activeContentIndex, classifyPageSync, relocatedCursor } from './reader-location';

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
};
export type ReaderPreferences = {
  layout: 'paginated' | 'scrolled';
  zoom: number;
  lineHeight: number;
  margin: number;
  theme: 'paper' | 'sepia';
};
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  layout: 'paginated',
  zoom: 1,
  lineHeight: 1.72,
  margin: 2,
  theme: 'paper',
};

type Props = {
  source?: string | Blob;
  product?: boolean;
  segments?: SyncSegment[];
  preferences?: ReaderPreferences;
  onLocation?: (location: ReaderLocation) => void;
  onReady?: () => void;
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
    onLocation,
    onReady,
    onError,
  },
  ref,
) {
  const host = useRef<View>(null);
  const reader = useRef<any>(null);
  const selection = useRef<{ index: number; range: Range } | undefined>(undefined);
  const cursor = useRef<ReaderLocation>(undefined);
  const page = useRef<{
    href: string;
    cfi: string;
    range: Range;
    state: ReaderLocation['syncState'];
  }>(undefined);
  const direction = useRef<'initial' | 'forward' | 'backward'>('initial');
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
        const target = capture.cfi || capture.href;
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
      },
      async restoreLocation(value, highlight = false) {
        const view = reader.current;
        if (!view || !value || typeof value !== 'object') return false;
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
        if (location.cfi) {
          await view.goTo(location.cfi);
          return true;
        }
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
        const resolved = await view.resolveNavigation(location.href);
        await view.goTo(location.href);
        const content = view.renderer
          .getContents()
          .find(({ index }: { index: number }) => index === resolved.index);
        const element = resolveDOMPath(content.doc, location.locator.dom_path);
        const range = content.doc.createRange();
        if (location.locator.start && location.locator.end) {
          range.setStart(
            resolveDOMPath(content.doc, location.locator.start.dom_path),
            location.locator.start.node_offset,
          );
          range.setEnd(
            resolveDOMPath(content.doc, location.locator.end.dom_path),
            location.locator.end.node_offset,
          );
        } else range.selectNodeContents(element);
        const cfi = view.getCFI(resolved.index, range);
        await view.goTo(cfi);
        if (highlight) {
          const selected = content.doc.getSelection();
          selected?.removeAllRanges();
          selected?.addRange(range);
        }
        if (cursor.current)
          onLocationRef.current?.({
            ...cursor.current,
            cfi,
            syncState: page.current?.state,
            reason: 'restore',
          });
        return true;
      },
    }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let view: any;
    void import('foliate-js/view.js')
      .then(async () => {
        if (disposed || !host.current) return;
        view = document.createElement('foliate-view') as any;
        view.style.width = '100%';
        view.style.height = product ? 'calc(100vh - 238px)' : '65vh';
        (host.current as unknown as HTMLElement).append(view);
        view.addEventListener('load', ({ detail: { doc, index } }: CustomEvent) => {
          if (product) {
            applyReaderStyles(doc, preferencesRef.current);
          }
          doc.addEventListener('selectionchange', () => {
            const selected = doc.getSelection();
            if (selected?.rangeCount && !selected.isCollapsed)
              selection.current = { index, range: selected.getRangeAt(0).cloneRange() };
          });
          doc.addEventListener('click', (event: MouseEvent) => {
            if (!product) return;
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
          const range = detail.range as Range | undefined;
          const index = range ? activeContentIndex(range, view.renderer.getContents()) : undefined;
          if (!range || index == null) return;
          const href = view.book.sections[index]?.id;
          if (!href) return;
          const state = pageSyncState(range, href, segmentsRef.current);
          page.current = { href, cfi: detail.cfi, range: range.cloneRange(), state };
          const fallback = !cursor.current
            ? containingSegment(range, href, segmentsRef.current)
            : undefined;
          cursor.current = relocatedCursor(
            cursor.current,
            fallback ? syncLocation(href, detail.cfi, fallback, state, 'relocate') : undefined,
            href,
          );
          const location: ReaderLocation = cursor.current
            ? { ...cursor.current, cfi: detail.cfi, syncState: state, reason: 'relocate' }
            : { href, cfi: detail.cfi, syncState: state, reason: 'relocate' };
          if (__DEV__)
            console.debug('Aldus relocation', {
              href,
              visible_start: boundary(range),
              visible_end: boundary(range, true),
              direction: direction.current,
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
        if (disposed) {
          view.remove();
          return;
        }
        view.renderer.setAttribute('flow', preferencesRef.current.layout);
        reader.current = view;
        onReadyRef.current?.();
      })
      .catch((error: unknown) => {
        view?.remove();
        if (!disposed)
          onErrorRef.current?.(
            error instanceof Error ? error : new Error('The EPUB could not be opened.'),
          );
      });
    return () => {
      disposed = true;
      view?.remove();
      if (reader.current === view) reader.current = null;
    };
  }, [source, product]);

  return (
    <View style={styles.reader}>
      <View ref={host} style={styles.book} />
      <View style={styles.navigation}>
        <IconButton
          icon="previousPage"
          label="Previous page"
          onPress={() => {
            direction.current = 'backward';
            reader.current?.goLeft();
          }}
        />
        <Text style={styles.hint}>
          {product
            ? 'Your place is saved as you turn pages.'
            : 'Highlight a passage in Alice, then click Capture selection.'}
        </Text>
        <IconButton
          icon="nextPage"
          label="Next page"
          onPress={() => {
            direction.current = 'forward';
            const current = page.current;
            if (current) {
              const match = trailingSegment(current.range, current.href, segments);
              if (match) {
                cursor.current = syncLocation(
                  current.href,
                  current.cfi,
                  match,
                  current.state,
                  'forward',
                );
                onLocationRef.current?.(cursor.current);
              }
            }
            reader.current?.goRight();
          }}
        />
      </View>
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
    if (
      !segment.highlightable ||
      segment.epub_href !== href ||
      !locator?.dom_path ||
      !locator.start ||
      !locator.end
    )
      continue;
    try {
      const doc = point.startContainer.ownerDocument!;
      const range = segmentRange(doc, locator);
      if (
        range.comparePoint(point.startContainer, point.startOffset) !== 0 ||
        sameBoundary(point, locator.end, doc)
      )
        continue;
      const before = range.cloneRange();
      before.setEnd(point.startContainer, point.startOffset);
      const total = normalize(range.toString()).length;
      return {
        id: segment.id,
        domPath: locator.dom_path,
        offset: total
          ? Math.min(
              1_000_000,
              Math.round((normalize(before.toString()).length * 1_000_000) / total),
            )
          : 0,
      };
    } catch {
      /* malformed boundaries fail closed */
    }
  }
}

function intersectingSegments(visible: Range, href: string, segments: SyncSegment[]) {
  return segments.filter((segment) => {
    if (segment.epub_href !== href) return false;
    const locator = segment.epub_locator as { start?: RangeBoundary; end?: RangeBoundary };
    if (!locator?.start || !locator.end) return false;
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

function trailingSegment(visible: Range, href: string, segments: SyncSegment[]) {
  const candidates = intersectingSegments(visible, href, segments)
    .filter((segment) => segment.highlightable)
    .sort((a, b) => a.ordinal - b.ordinal);
  const segment = candidates.at(-1);
  if (!segment) return;
  const locator = segment.epub_locator as {
    dom_path: string;
    start: RangeBoundary;
    end: RangeBoundary;
  };
  try {
    const doc = visible.startContainer.ownerDocument!;
    const range = segmentRange(doc, locator);
    if (
      range.comparePoint(visible.endContainer, visible.endOffset) === 0 &&
      !sameBoundary(visible, locator.end, doc, true)
    ) {
      const point = visible.cloneRange();
      point.collapse(false);
      return containingSegment(point, href, [segment]);
    }
    return { id: segment.id, domPath: locator.dom_path, offset: 999_999 };
  } catch {
    return;
  }
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

function segmentRange(doc: Document, locator: { start?: RangeBoundary; end?: RangeBoundary }) {
  if (!locator.start || !locator.end) throw new Error('Missing segment boundaries');
  const range = doc.createRange();
  range.setStart(resolveDOMPath(doc, locator.start.dom_path), locator.start.node_offset);
  range.setEnd(resolveDOMPath(doc, locator.end.dom_path), locator.end.node_offset);
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
  const background = preferences.theme === 'sepia' ? colors.canvas : colors.paper;
  style.textContent = `html { color: ${colors.ink}; background: ${background}; } body { font-family: Georgia, 'Times New Roman', serif; font-size: ${1.08 * preferences.zoom}rem; line-height: ${preferences.lineHeight}; padding-inline: clamp(1rem, 4vw, ${preferences.margin + 1.5}rem); } p { max-width: 68ch; margin-inline: auto; } h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif; line-height: 1.2; } ::selection { background: ${colors.accentSoft}; color: ${colors.ink}; }`;
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
  reader: { flex: 1, minHeight: 560 },
  book: { flex: 1, minHeight: 500, overflow: 'hidden', backgroundColor: '#fffdf8' },
  navigation: {
    minHeight: 52,
    borderTopWidth: 1,
    borderTopColor: '#c9c0b3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  hint: { color: '#746a5f', fontSize: 12 },
});
