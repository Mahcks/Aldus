import type { LibrarySource, SourceEntry, SourceRoot, SourceScan } from '../../generated/api';

/** Matches `StatusBadge`'s tone union without importing a component into pure logic. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Health summary for a `LibrarySource` card. Disabled sources always read as
 * neutral regardless of scan history so "disabled" and "healthy" never look
 * alike; enabled sources take their tone from the most recent scan.
 */
export function sourceStatus(
  source: LibrarySource,
  latestScan?: SourceScan,
): { tone: StatusTone; label: string } {
  if (!source.enabled) return { tone: 'neutral', label: 'Disabled' };
  if (!latestScan) return { tone: 'info', label: 'Not yet scanned' };
  if (latestScan.state === 'scanning') return { tone: 'info', label: 'Scanning…' };
  if (latestScan.state === 'pending') return { tone: 'info', label: 'Scan pending' };
  if (latestScan.state === 'failed') return { tone: 'danger', label: 'Scan failed' };
  return { tone: 'success', label: 'Ready' };
}

/** Tone for a single scan's own state, used in scan history rows. */
export function scanStatus(state: string): { tone: StatusTone; label: string } {
  if (state === 'scanning') return { tone: 'info', label: 'Scanning…' };
  if (state === 'pending') return { tone: 'info', label: 'Pending' };
  if (state === 'failed') return { tone: 'danger', label: 'Failed' };
  if (state === 'completed') return { tone: 'success', label: 'Completed' };
  return { tone: 'neutral', label: humanState(state) };
}

/** Tone for an import proposal's review state. */
export function proposalStatus(state: string): { tone: StatusTone; label: string } {
  if (state === 'review_required') return { tone: 'warning', label: 'Needs review' };
  if (state === 'obsolete') return { tone: 'neutral', label: 'Obsolete' };
  return { tone: 'info', label: 'New discovery' };
}

/** Tone for a single discovered file's inventory state. */
export function entryStatus(state: string): { tone: StatusTone; label: string } {
  if (state === 'registered') return { tone: 'success', label: 'Registered' };
  if (state === 'missing') return { tone: 'danger', label: 'Missing' };
  if (state === 'error') return { tone: 'danger', label: 'Error' };
  return { tone: 'neutral', label: humanState(state) };
}

export function humanState(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function formatDate(value?: string) {
  if (!value) return 'Not started';
  return new Date(value).toLocaleString();
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function metadataText(entry: SourceEntry, key: string) {
  const value: unknown = entry.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Finds which configured root a source's absolute `root_path` lives under,
 * and the path relative to that root, so the folder browser can resume
 * exactly where an existing source points instead of starting from scratch.
 * Returns undefined when no configured root is a prefix of the path (the
 * admin will fall back to picking a root from scratch).
 */
export function findRootForPath(
  roots: SourceRoot[],
  absolutePath: string,
): { root: SourceRoot; relativePath: string } | undefined {
  if (!absolutePath) return undefined;
  const match = roots.find(
    (root) => absolutePath === root.path || absolutePath.startsWith(`${root.path}/`),
  );
  if (!match) return undefined;
  const relativePath = absolutePath.slice(match.path.length).replace(/^\/+/, '');
  return { root: match, relativePath };
}
