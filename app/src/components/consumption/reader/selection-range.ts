import type { EPUBSelectionRange } from '@/generated/api';
import { parseSelection } from '@/lib/consumption/resume-selection';

export function captureSelectionRange(doc: Document, href: string): EPUBSelectionRange | undefined {
  const selection = doc.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !doc.body) return;
  const range = selection.getRangeAt(0);
  if (!doc.body.contains(range.startContainer) || !doc.body.contains(range.endContainer)) return;
  const before = doc.createRange();
  before.selectNodeContents(doc.body);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.selectNodeContents(doc.body);
  after.setStart(range.endContainer, range.endOffset);
  const normalize = (text: string) => text.replace(/\s+/gu, ' ');
  return parseSelection({
    href,
    text: normalize(range.toString()).trim(),
    before: normalize(before.toString()).slice(-160),
    after: normalize(after.toString()).slice(0, 160),
  });
}
