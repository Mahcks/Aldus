/** Resolve the existing normalized, code-point offset back into the segment's DOM. */
export function canonicalResumeRange(segment: Range, offset: number): Range {
  if (!Number.isFinite(offset) || offset < 0 || offset > 1_000_000) {
    throw new Error('The saved text position is invalid.');
  }
  const doc = segment.startContainer.ownerDocument!;
  const root = segment.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  type Point = { node: Text; offset: number };
  const characters: { text: string; start: Point; end: Point }[] = [];
  let whitespace: { start: Point; end: Point } | undefined;
  let current: Node | null = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
  while (current) {
    const node = current as Text;
    let index = 0;
    for (const text of node.data) {
      const end = index + text.length;
      if (segment.comparePoint(node, index) === 0 && segment.comparePoint(node, end) === 0) {
        const startPoint = { node, offset: index };
        const endPoint = { node, offset: end };
        if (/\s/u.test(text)) {
          whitespace = { start: whitespace?.start ?? startPoint, end: endPoint };
        } else {
          if (whitespace && characters.length) characters.push({ text: ' ', ...whitespace });
          whitespace = undefined;
          characters.push({ text, start: startPoint, end: endPoint });
        }
      }
      index = end;
    }
    current = walker.nextNode();
  }
  if (!characters.length) throw new Error('The saved passage has no text.');
  let index = Math.round((offset * characters.length) / 1_000_000);
  // Saving trims trailing whitespace in the prefix. Its inverse is the next
  // text character, including across inline elements and collapsed whitespace.
  while (characters[index]?.text === ' ') index++;
  const result = segment.cloneRange();
  if (index === characters.length) {
    const end = characters.at(-1)!.end;
    result.setStart(end.node, end.offset);
    result.collapse(true);
    return result;
  }
  const start = characters[index].start;
  let endIndex = index;
  while (characters[endIndex + 1] && characters[endIndex + 1].text !== ' ') endIndex++;
  const end = characters[endIndex].end;
  result.setStart(start.node, start.offset);
  result.setEnd(end.node, end.offset);
  return result;
}
