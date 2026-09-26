import { describe, expect, it } from 'bun:test';
import {
  activeElsewhereHint,
  conflictCopy,
  deviceName,
  lastActiveLabel,
  pausedCopy,
  saveStatusView,
  savedPlaceName,
  syncReadinessView,
  takeoverCopy,
  type HandoffDevice,
} from './handoff-copy';

const iphone: HandoffDevice = { platform: 'ios' };
const web: HandoffDevice = { platform: 'web' };

describe('deviceName', () => {
  it('prefers the account label and falls back to the platform', () => {
    expect(deviceName({ platform: 'ios', label: 'Max’s iPhone' })).toBe('Max’s iPhone');
    expect(deviceName({ platform: 'ios', label: '  ' })).toBe('your iPhone');
    expect(deviceName(web)).toBe('Aldus on the web');
    expect(deviceName({ platform: 'android' })).toBe('your Android device');
    expect(deviceName({ platform: 'other' })).toBe('another device');
  });
});

describe('lastActiveLabel', () => {
  it('words recent, minute, hour and old activity', () => {
    expect(lastActiveLabel(undefined)).toBeUndefined();
    expect(lastActiveLabel(20)).toBe('Last active just now');
    expect(lastActiveLabel(60)).toBe('Last active 1 minute ago');
    expect(lastActiveLabel(120)).toBe('Last active 2 minutes ago');
    expect(lastActiveLabel(3 * 3600)).toBe('Last active 3 hours ago');
    expect(lastActiveLabel(30 * 3600)).toBe('Last active more than a day ago');
  });
});

describe('activeElsewhereHint', () => {
  it('says who is reading and how recently, without asking anything', () => {
    expect(activeElsewhereHint(iphone, 120)).toBe('Reading on your iPhone · 2 minutes ago');
    expect(activeElsewhereHint(web, 10)).toBe('Reading on Aldus on the web · just now');
  });
});

describe('takeoverCopy prompt', () => {
  it('names the book, device and saved place and reassures while the device is recent', () => {
    const copy = takeoverCopy(
      { kind: 'prompt', device: iphone, secondsSinceActive: 120, position: 'Chapter 7 · 2:58:22' },
      'Treasure Island',
    );

    expect(copy.title).toBe('Continue on this device?');
    expect(copy.body).toBe('Treasure Island is open on your iPhone.');
    expect(copy.lastActive).toBe('Last active 2 minutes ago');
    expect(copy.savedPlace).toBe('Chapter 7 · 2:58:22');
    expect(copy.help).toBe(
      'If you continue here, your iPhone will pause. Your place moves with you.',
    );
    expect(copy.primary).toBe('Continue here');
    expect(copy.secondary).toBe('Not now');
  });

  it('says the other device may be offline after long silence, never promising it will pause now', () => {
    const copy = takeoverCopy(
      { kind: 'prompt', device: iphone, secondsSinceActive: 11 * 60, position: 'Chapter 3' },
      'Treasure Island',
    );

    expect(copy.help).toContain('may be offline');
    expect(copy.help).toContain('will pause when it next connects');
    expect(copy.help).not.toContain('Your place moves with you');
  });

  it('omits the saved place row when it is not known', () => {
    const copy = takeoverCopy({ kind: 'prompt', device: web }, 'Treasure Island');

    expect(copy.savedPlace).toBeUndefined();
  });

  it('omits the activity row when the server did not say', () => {
    const copy = takeoverCopy(
      { kind: 'prompt', device: web, position: 'Chapter 3' },
      'Treasure Island',
    );

    expect(copy.lastActive).toBeUndefined();
  });
});

describe('takeoverCopy pending', () => {
  it('shows the server step first and the restore step second, never claiming success', () => {
    const server = takeoverCopy(
      { kind: 'pending', device: iphone, step: 'server', slow: false },
      'X',
    );
    const restore = takeoverCopy(
      { kind: 'pending', device: iphone, step: 'restore', slow: false },
      'X',
    );

    expect(server.steps?.map((step) => step.state)).toEqual(['now', 'wait']);
    expect(restore.steps?.map((step) => step.state)).toEqual(['done', 'now']);
    expect(server.title).toBe('Moving your place here…');
    expect(server.body).toBe(
      'Keep this page open. Your iPhone will pause once your server confirms.',
    );
    expect(server.secondary).toBeUndefined();
    expect(JSON.stringify(server)).not.toMatch(/moved|done|up to date/i);
  });

  it('offers Cancel only once the transfer is slow', () => {
    const slow = takeoverCopy({ kind: 'pending', device: iphone, step: 'server', slow: true }, 'X');

    expect(slow.footnote).toBe('Taking longer than usual.');
    expect(slow.secondary).toBe('Cancel');
  });
});

describe('takeoverCopy failures', () => {
  it('says the other device is still active when the transfer never happened', () => {
    const unreachable = takeoverCopy(
      { kind: 'failed', device: iphone, reason: 'unreachable' },
      'X',
    );
    const refused = takeoverCopy({ kind: 'failed', device: iphone, reason: 'refused' }, 'X');

    expect(unreachable.body).toBe(
      'Aldus couldn’t reach your server, so your iPhone is still active and your saved place hasn’t changed.',
    );
    expect(refused.body).toBe(
      'Your server didn’t switch devices, so your iPhone is still active and your saved place hasn’t changed.',
    );
    expect(unreachable.primary).toBe('Try again');
    expect(unreachable.secondary).toBe('Not now');
    expect(unreachable.tone).toBe('error');
  });

  it('separates a place that would not open from a transfer that failed', () => {
    const restore = takeoverCopy(
      { kind: 'failed', device: iphone, reason: 'restore', position: 'Chapter 3 · 41%' },
      'X',
    );
    const offline = takeoverCopy({ kind: 'failed', device: iphone, reason: 'not-downloaded' }, 'X');

    expect(restore.title).toBe('This device is active, but your place didn’t open');
    expect(restore.body).toContain('Chapter 3 · 41%');
    expect(restore.body).toContain('Progress isn’t being saved yet.');
    expect(restore.secondary).toBe('Back to book');
    expect(offline.body).toContain('isn’t downloaded');
  });

  it('never tells the user they are up to date', () => {
    const reasons = ['unreachable', 'refused', 'restore', 'not-downloaded'] as const;

    for (const reason of reasons) {
      const copy = takeoverCopy({ kind: 'failed', device: iphone, reason }, 'X');
      expect(JSON.stringify(copy)).not.toMatch(/up to date/i);
    }
  });
});

describe('pausedCopy', () => {
  it('pauses the player with a reason for its disabled controls', () => {
    const copy = pausedCopy('player', iphone);

    expect(copy.title).toBe('Continued on your iPhone');
    expect(copy.action).toBe('Resume here');
    expect(copy.reason).toBe('Paused — continued on your iPhone');
    expect(copy.announcement).toBe('Continued on your iPhone. Playback paused.');
  });

  it('pauses reader page turns instead of playback', () => {
    const copy = pausedCopy('reader', web);

    expect(copy.body).toContain('Page turns are paused until you resume.');
    expect(copy.announcement).toBe('Continued on Aldus on the web. Page turns paused.');
  });
});

describe('conflictCopy', () => {
  it('keeps both places until the user decides and never sets a deletion window', () => {
    const copy = conflictCopy(iphone);

    expect(copy.title).toBe('Two saved places');
    expect(copy.body).toContain('Aldus keeps both places until you decide.');
    expect(copy.body).not.toMatch(/\d+ days/);
    expect(copy.primary).toBe('Continue from selected place');
    expect(copy.secondary).toBe('Decide later');
  });

  it('names the two places', () => {
    expect(savedPlaceName({ id: 'this-device', device: web, position: 'x', savedLabel: 'y' })).toBe(
      'This device',
    );
    expect(
      savedPlaceName({ id: 'other-device', device: iphone, position: 'x', savedLabel: 'y' }),
    ).toBe('Your iPhone');
  });
});

describe('saveStatusView', () => {
  it('keeps the existing reading and listening wording', () => {
    expect(saveStatusView('saved', 'read').label).toBe('Reading place saved');
    expect(saveStatusView('saved', 'listen').label).toBe('Progress saves automatically');
    expect(saveStatusView('saving', 'read').label).toBe('Saving…');
    expect(saveStatusView('error', 'read').label).toBe('Couldn’t save');
  });

  it('separates a place saved on this device from one the server confirmed', () => {
    const local = saveStatusView('on-device', 'read');
    const server = saveStatusView('saved', 'read');

    expect(local.label).toBe('Saved on this device · Waiting to upload');
    expect(local.tone).toBe('neutral');
    expect(server.tone).toBe('success');
    expect(local.label).not.toBe(server.label);
  });

  it('warns while another device is in charge', () => {
    expect(saveStatusView('paused', 'read')).toEqual({
      label: 'Not saving progress',
      tone: 'warning',
      icon: 'warning',
    });
  });
});

describe('syncReadinessView', () => {
  it('describes only ebook and audiobook readiness, never a device', () => {
    const states = ['preparing', 'ready', 'separate'] as const;

    for (const state of states) {
      expect(syncReadinessView(state).label).not.toMatch(/device|iPhone|web/i);
    }
    expect(syncReadinessView('separate').label).toContain('its own saved place');
  });
});
