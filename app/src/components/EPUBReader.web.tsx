import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  sync?: { href: string; locator: { type: 'dom-element'; dom_path: string }; offset: number };
};
export type EPUBReaderHandle = {
  captureSelection: () => ReaderCapture | null;
  restoreSelection: (capture: ReaderCapture) => Promise<string>;
  restoreLocation: (location: unknown, highlight?: boolean) => Promise<boolean>;
};

type Props = { source?: string | Blob; product?: boolean; onLocation?: (location: ReaderLocation) => void; onReady?: () => void };

export const EPUBReader = forwardRef<EPUBReaderHandle, Props>(function EPUBReader({ source = '/media/alice.epub', product, onLocation, onReady }, ref) {
  const host = useRef<View>(null);
  const reader = useRef<any>(null);
  const selection = useRef<{ index: number; range: Range } | undefined>(undefined);
  const onLocationRef = useRef(onLocation); const onReadyRef = useRef(onReady);
  onLocationRef.current = onLocation; onReadyRef.current = onReady;

  useImperativeHandle(ref, () => ({
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
      const content = view.renderer.getContents().find(({ index }: { index: number }) => index === resolved.index);
      const range = capture.cfi ? resolved.anchor(content.doc) as Range : restoreDOMRange(content.doc, capture);
      const selected = content.doc.getSelection();
      selected?.removeAllRanges();
      selected?.addRange(range);
      selection.current = { index: resolved.index, range: range.cloneRange() };
      return range.toString();
    },
    async restoreLocation(value, highlight = false) {
      const view = reader.current;
      if (!view || !value || typeof value !== 'object') return false;
      const location = value as { href?: string; cfi?: string; locator?: { type?: string; dom_path?: string } };
      if (location.cfi) {
        await view.goTo(location.cfi);
        return true;
      }
      if (!location.href || location.locator?.type !== 'dom-element' || !location.locator.dom_path) return false;
      const resolved = await view.resolveNavigation(location.href);
      await view.goTo(location.href);
      const content = view.renderer.getContents().find(({ index }: { index: number }) => index === resolved.index);
      const element = resolveDOMPath(content.doc, location.locator.dom_path);
      const range = content.doc.createRange();
      range.selectNodeContents(element);
      const cfi = view.getCFI(resolved.index, range);
      await view.goTo(cfi);
      if (highlight) {
        const selected = content.doc.getSelection();
        selected?.removeAllRanges();
        selected?.addRange(range);
      }
      return true;
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    import('foliate-js/view.js').then(async () => {
      if (disposed || !host.current) return;
      const view = document.createElement('foliate-view') as any;
      view.style.width = '100%';
      view.style.height = '65vh';
      (host.current as unknown as HTMLElement).append(view);
      view.addEventListener('load', ({ detail: { doc, index } }: CustomEvent) => {
        doc.addEventListener('selectionchange', () => {
          const selected = doc.getSelection();
          if (selected?.rangeCount && !selected.isCollapsed) selection.current = { index, range: selected.getRangeAt(0).cloneRange() };
        });
      });
      view.addEventListener('relocate', ({ detail }: CustomEvent) => {
        const range = detail.range as Range | undefined;
        const index = detail.index as number;
        const href = view.book.sections[index]?.id;
        if (!range || !href) return;
        const paragraph = closestParagraph(range.startContainer);
        const location: ReaderLocation = { href, cfi: detail.cfi };
        if (paragraph) location.sync = { href, locator: { type: 'dom-element', dom_path: domPath(paragraph) }, offset: paragraphOffset(paragraph, range) };
        onLocationRef.current?.(location);
      });
      await view.open(source);
      view.renderer.setAttribute('flow', 'paginated');
      reader.current = view;
      onReadyRef.current?.();
    });
    return () => {
      disposed = true;
      reader.current?.remove();
      reader.current = null;
    };
  }, [source]);

  return (
    <View style={styles.reader}>
      <View ref={host} style={styles.book} />
      <View style={styles.navigation}>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => reader.current?.goLeft()}><Text style={styles.buttonText}>Previous page</Text></Pressable>
        <Text style={styles.hint}>{product ? 'Your place is saved as you turn pages.' : 'Highlight a passage in Alice, then click Capture selection.'}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => reader.current?.goRight()}><Text style={styles.buttonText}>Next page</Text></Pressable>
      </View>
    </View>
  );
});

function closestParagraph(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest('p') ?? null;
}

function paragraphOffset(paragraph: Element, visible: Range) {
  try {
    const before = paragraph.ownerDocument.createRange();
    before.selectNodeContents(paragraph);
    before.setEnd(visible.startContainer, visible.startOffset);
    const total = normalize(paragraph.textContent ?? '').length;
    return total ? Math.min(1_000_000, Math.round(normalize(before.toString()).length * 1_000_000 / total)) : 0;
  } catch {
    return 0;
  }
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
    const candidates = name === 'text()'
      ? Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE)
      : Array.from(node.childNodes).filter((child) => child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === name);
    node = candidates[Number(rawIndex) - 1];
    if (!node) throw new Error(`DOM path not found: ${path}`);
  }
  return node;
}

function domPath(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const siblings = Array.from(node.parentNode?.childNodes ?? []).filter((sibling) => sibling.nodeType === Node.TEXT_NODE);
    return `${domPath(node.parentNode!)}/text()[${siblings.indexOf(node as ChildNode) + 1}]`;
  }
  const element = node as Element;
  if (element.tagName?.toLowerCase() === 'html') return 'html[1]';
  const parent = element.parentElement;
  const tag = element.tagName.toLowerCase();
  const siblings = Array.from(parent?.children ?? []).filter((sibling) => sibling.tagName === element.tagName);
  return `${domPath(parent!)}/${tag}[${siblings.indexOf(element) + 1}]`;
}

const styles = StyleSheet.create({
  reader: { flex: 1, minHeight: 620 }, book: { flex: 1, minHeight: 560, overflow: 'hidden' },
  navigation: { height: 52, borderTopWidth: 1, borderTopColor: '#c9c0b3', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  button: { borderWidth: 1, borderColor: '#a99d8e', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fffdf9' },
  buttonText: { color: '#40372f', fontSize: 13, fontWeight: '600' }, hint: { color: '#746a5f', fontSize: 12 },
});
