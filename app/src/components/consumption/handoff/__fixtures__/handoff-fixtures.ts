import type { HandoffDevice, SavedPlaceOption, TakeoverView } from '@/lib/consumption/handoff-copy';

/**
 * Sample data for previewing and testing the handoff presenters. Imported only
 * by tests and the development preview route; production code must never
 * import this file.
 */
export const fixtureIPhone: HandoffDevice = { platform: 'ios' };
export const fixtureWeb: HandoffDevice = { platform: 'web' };

export const fixtureViews: Record<string, TakeoverView> = {
  prompt: {
    kind: 'prompt',
    device: fixtureWeb,
    secondsSinceActive: 120,
    position: 'Chapter 7 · 2:58:22',
  },
  promptSilent: {
    kind: 'prompt',
    device: fixtureIPhone,
    secondsSinceActive: 3 * 3600,
    position: 'Chapter 3 · 41%',
  },
  pendingServer: { kind: 'pending', device: fixtureWeb, step: 'server', slow: false },
  pendingRestore: { kind: 'pending', device: fixtureWeb, step: 'restore', slow: false },
  pendingSlow: { kind: 'pending', device: fixtureWeb, step: 'server', slow: true },
  failedUnreachable: { kind: 'failed', device: fixtureWeb, reason: 'unreachable' },
  failedRefused: { kind: 'failed', device: fixtureWeb, reason: 'refused' },
  failedRestore: {
    kind: 'failed',
    device: fixtureWeb,
    reason: 'restore',
    position: 'Chapter 3 · 41%',
  },
  failedNotDownloaded: { kind: 'failed', device: fixtureWeb, reason: 'not-downloaded' },
};

export const fixtureConflictOptions: SavedPlaceOption[] = [
  {
    id: 'this-device',
    device: fixtureIPhone,
    position: 'Chapter 5 · 58%',
    savedLabel: 'Saved offline today at 9:41 PM',
  },
  {
    id: 'other-device',
    device: fixtureWeb,
    position: 'Chapter 3 · 41%',
    savedLabel: 'Saved today at 8:15 PM',
  },
];
