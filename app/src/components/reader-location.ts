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

export function relocatedCursor<T>(committed: T | undefined, fallback: T | undefined) {
  return committed ?? fallback;
}

export function commitsReadingProgress(reason?: string) {
  return reason === 'forward' || reason === 'explicit';
}

const meaningful = (element: Element) => Boolean(element.textContent?.replace(/\s+/g, ' ').trim());
