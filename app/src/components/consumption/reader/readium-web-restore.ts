import type { Locator } from 'react-native-readium';

// Keep word spacing exact, while accepting the paragraph separators inserted by
// native selection. DOM Range.toString() can omit those separators entirely.
export function findReadiumRange(doc: Document, locator: Locator): Range | undefined {
  const compact = (text: string) => text.replace(/\s+/gu, '');
  const quote = (locator.text?.highlight ?? '').replace(/\s+/gu, ' ').trim();
  const before = compact(locator.text?.before ?? '');
  const after = compact(locator.text?.after ?? '');
  if (!quote || !doc.body) return undefined;

  const nodes: { node: Text; start: number; end: number; block: Element | null }[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let length = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text;
    if (node.parentElement?.closest('script, style, noscript, [hidden], [aria-hidden="true"]'))
      continue;
    nodes.push({
      node,
      start: length,
      end: length + node.length,
      block:
        node.parentElement?.closest('p, div, li, blockquote, h1, h2, h3, h4, h5, h6, td, th') ??
        null,
    });
    length += node.length;
  }

  let match: { start: number; end: number } | undefined;
  for (const paragraphSpaces of [false, true]) {
    const offsets: number[] = [];
    const characters: string[] = [];
    let previousBlock: Element | null | undefined;
    for (const { node, start, block } of nodes) {
      if (
        paragraphSpaces &&
        previousBlock !== undefined &&
        block !== previousBlock &&
        characters.length &&
        characters.at(-1) !== ' '
      ) {
        characters.push(' ');
        offsets.push(start);
      }
      previousBlock = block;
      for (let offset = 0; offset < node.length; offset++) {
        const character = /\s/u.test(node.data[offset]) ? ' ' : node.data[offset];
        if (character === ' ' && characters.at(-1) === ' ') continue;
        characters.push(character);
        offsets.push(start + offset);
      }
    }
    const text = characters.join('');
    for (let index = text.indexOf(quote); index >= 0; index = text.indexOf(quote, index + 1)) {
      if (
        before &&
        !compact(text.slice(Math.max(0, index - before.length * 2), index)).endsWith(before)
      )
        continue;
      const end = index + quote.length;
      if (after && !compact(text.slice(end, end + after.length * 2)).startsWith(after)) continue;
      const next = { start: offsets[index], end: offsets[end - 1] };
      if (match && (match.start !== next.start || match.end !== next.end)) return undefined;
      match = next;
    }
  }
  if (!match) return undefined;

  const { start, end } = match;
  const first = nodes.find((entry) => start >= entry.start && start < entry.end);
  const last = nodes.find((entry) => end >= entry.start && end < entry.end);
  if (!first || !last) return undefined;
  const range = doc.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start + 1);
  return range;
}
