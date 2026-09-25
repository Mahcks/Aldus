import type { Locator } from 'react-native-readium';

// Normalize whitespace runs without losing word boundaries or DOM offsets.
// Readium's surrounding context can add paragraph spaces absent from the DOM.
export function findReadiumRange(doc: Document, locator: Locator): Range | undefined {
  const compact = (text: string) => text.replace(/\s+/gu, '');
  const quote = (locator.text?.highlight ?? '').replace(/\s+/gu, ' ').trim();
  const before = compact(locator.text?.before ?? '');
  const after = compact(locator.text?.after ?? '');
  if (!quote || !doc.body) return undefined;

  const nodes: { node: Text; start: number; end: number }[] = [];
  const offsets: number[] = [];
  const characters: string[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let length = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text;
    if (node.parentElement?.closest('script, style, noscript, [hidden], [aria-hidden="true"]'))
      continue;
    nodes.push({ node, start: length, end: length + node.length });
    for (let offset = 0; offset < node.length; offset += 1) {
      const character = /\s/u.test(node.data[offset]) ? ' ' : node.data[offset];
      if (character === ' ' && characters.at(-1) === ' ') continue;
      characters.push(character);
      offsets.push(length + offset);
    }
    length += node.length;
  }
  const text = characters.join('');
  let match: number | undefined;
  for (let index = text.indexOf(quote); index >= 0; index = text.indexOf(quote, index + 1)) {
    // Collapsed text contains at most one space between each context character.
    if (
      before &&
      !compact(text.slice(Math.max(0, index - before.length * 2), index)).endsWith(before)
    )
      continue;
    const end = index + quote.length;
    if (after && !compact(text.slice(end, end + after.length * 2)).startsWith(after)) continue;
    if (match !== undefined) return undefined;
    match = index;
  }
  if (match === undefined) return undefined;

  const start = offsets[match];
  const end = offsets[match + quote.length - 1];
  const first = nodes.find((entry) => start >= entry.start && start < entry.end);
  const last = nodes.find((entry) => end >= entry.start && end < entry.end);
  if (!first || !last) return undefined;
  const range = doc.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start + 1);
  return range;
}
