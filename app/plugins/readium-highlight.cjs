// Whole-range client rects include fully selected element boxes. Decorations
// should cover the selected text lines, not paragraph backgrounds or margins.
function highlightTextRects(range) {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects = [];
  let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
  while (node) {
    if (range.intersectsNode(node) && node.textContent.length) {
      const part = doc.createRange();
      part.selectNodeContents(node);
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
        part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
        part.setEnd(range.endContainer, range.endOffset);
      if (!part.collapsed)
        rects.push(
          ...Array.from(part.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0),
        );
    }
    node = walker.nextNode();
  }
  return rects;
}

function patchHighlightRects(source) {
  const hook = 'function D(t,e){let r=t.getClientRects();const n=[];';
  const patched = `function D(t,e){let r=/* Aldus text highlight begin */(${highlightTextRects.toString()})(t)/* Aldus text highlight end */;const n=[];`;
  source = source.replace(
    /\/\* Aldus text highlight begin \*\/[\s\S]*?\/\* Aldus text highlight end \*\//g,
    't.getClientRects()',
  );
  if (source.split(hook).length !== 2)
    throw new Error('Readium decoration rectangles changed; review the text highlight patch.');
  return source.replace(hook, patched);
}

module.exports = { highlightTextRects, patchHighlightRects };
