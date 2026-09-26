import type {
  CanonicalPosition,
  EPUBResumeSelection,
  EPUBSelectionRange,
  Media,
  WorkProgressUpdate,
} from '@/generated/api';

export function parseSelection(value: unknown): EPUBSelectionRange | undefined {
  if (!value || typeof value !== 'object') return;
  const s = value as EPUBSelectionRange;
  if (
    typeof s.href !== 'string' ||
    !s.href ||
    typeof s.text !== 'string' ||
    !s.text.trim() ||
    typeof s.before !== 'string' ||
    typeof s.after !== 'string' ||
    s.text.length > 16000 ||
    s.before.length > 160 ||
    s.after.length > 160
  )
    return;
  return { href: s.href, text: s.text, before: s.before, after: s.after };
}

export function selectionLocator(range: EPUBSelectionRange) {
  return {
    href: range.href,
    type: 'application/xhtml+xml',
    locations: { progression: 0 },
    text: { highlight: range.text, before: range.before, after: range.after },
  };
}

export function savedSelection(
  range: EPUBSelectionRange,
  media: Media,
  progress?: CanonicalPosition,
): EPUBResumeSelection {
  return { version: 1, media_id: media.id, sha256: media.sha256, range, progress };
}

function samePoint(a: CanonicalPosition, b: CanonicalPosition | WorkProgressUpdate) {
  return (
    a.alignment_id === b.alignment_id && a.segment_id === b.segment_id && a.offset === b.offset
  );
}

/** Supplement the authoritative point only when the range belongs to this exact save/file. */
export function withResumeSelection(
  target: unknown,
  saved: unknown,
  media: Media | undefined,
  progress?: CanonicalPosition | null,
  pending?: WorkProgressUpdate | null,
) {
  if (!target || typeof target !== 'object') return target;
  const clean = { ...target } as Record<string, unknown>;
  delete clean.resume_selection;
  if (!saved || typeof saved !== 'object' || !media) return clean;
  const selection = (saved as { resume_selection?: EPUBResumeSelection }).resume_selection;
  const range = parseSelection(selection?.range);
  if (!selection || selection.version !== 1 || !range) return clean;
  if (selection.media_id !== media.id || selection.sha256 !== media.sha256)
    return progress ? clean : { ...clean, stale_selection_file: true };
  const resource = (href: string) => {
    try {
      return decodeURIComponent(href).split('#')[0];
    } catch {
      return href.split('#')[0];
    }
  };
  if (typeof clean.href !== 'string' || resource(clean.href) !== resource(range.href)) return clean;
  if (progress) {
    const binding = selection.progress;
    if (!binding || !samePoint(binding, progress)) return clean;
    const expectedRevision =
      pending && samePoint(binding, pending) ? pending.expected_revision + 1 : progress.revision;
    if (
      !Number.isSafeInteger(binding.revision) ||
      (binding.revision ?? 0) < 1 ||
      binding.revision !== expectedRevision
    )
      return clean;
  } else if (selection.progress) return clean;
  return { ...clean, resume_selection: selection };
}

/** Only call after file/revision eligibility has been checked by withResumeSelection. */
export function restoreSelectionRange(target: unknown) {
  return target && typeof target === 'object'
    ? parseSelection((target as { resume_selection?: EPUBResumeSelection }).resume_selection?.range)
    : undefined;
}

/** An explicit choice of the local conflict may rebind its own range to the accepted revision. */
export function rebindChosenSelection(
  saved: unknown,
  media: Media | undefined,
  progress: CanonicalPosition,
) {
  if (!saved || typeof saved !== 'object' || !media) return;
  const selection = (saved as { resume_selection?: EPUBResumeSelection }).resume_selection;
  if (
    !selection?.progress ||
    !samePoint(selection.progress, progress) ||
    !parseSelection(selection.range) ||
    selection.version !== 1 ||
    selection.media_id !== media.id ||
    selection.sha256 !== media.sha256
  )
    return;
  return { ...saved, resume_selection: { ...selection, progress } };
}
