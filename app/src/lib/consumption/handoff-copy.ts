/**
 * Wording and view models for moving a reading or listening session between
 * devices. Everything here is presentation: it describes what the screen says
 * for a state it is handed, and never decides ownership, saves, or restores.
 */

export type HandoffPlatform = 'ios' | 'android' | 'web' | 'other';

export type HandoffDevice = {
  /** The account's name for the device, when the server knows one. */
  label?: string;
  platform: HandoffPlatform;
};

/** After this much silence the other device may be offline, so the copy stops reassuring. */
export const MAY_BE_OFFLINE_AFTER_SECONDS = 10 * 60;

/** How long a takeover may take before the dialog admits it and offers Cancel. */
export const SLOW_TRANSFER_AFTER_SECONDS = 10;

export type TakeoverView =
  | {
      kind: 'prompt';
      device: HandoffDevice;
      secondsSinceActive?: number;
      /** Where the saved place is, e.g. "Chapter 7 · 2:58:22", when it is known. */
      position?: string;
    }
  | {
      kind: 'pending';
      device: HandoffDevice;
      step: 'server' | 'restore';
      slow: boolean;
    }
  | {
      kind: 'failed';
      device: HandoffDevice;
      reason: 'unreachable' | 'refused' | 'restore' | 'not-downloaded';
      position?: string;
    };

export type TakeoverStep = {
  label: string;
  state: 'done' | 'now' | 'wait';
};

export type TakeoverCopy = {
  title: string;
  body: string;
  /** Rows under the body, shown only when the server told us. */
  lastActive?: string;
  savedPlace?: string;
  help?: string;
  steps?: TakeoverStep[];
  footnote?: string;
  primary?: string;
  secondary?: string;
  /** Read once by a screen reader when this state appears. */
  announcement: string;
  tone: 'default' | 'error';
};

export function deviceName(device: HandoffDevice) {
  if (device.label?.trim()) return device.label.trim();
  switch (device.platform) {
    case 'ios':
      return 'your iPhone';
    case 'android':
      return 'your Android device';
    case 'web':
      return 'Aldus on the web';
    default:
      return 'another device';
  }
}

function activityAgo(secondsAgo: number) {
  if (secondsAgo < 60) return 'just now';

  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  return 'more than a day ago';
}

export function lastActiveLabel(secondsAgo?: number) {
  if (secondsAgo == null || secondsAgo < 0) return undefined;
  return `Last active ${activityAgo(secondsAgo)}`;
}

/** The read-only hint on book details. It never claims the book. */
export function activeElsewhereHint(device: HandoffDevice, secondsAgo: number) {
  return `Reading on ${deviceName(device)} · ${activityAgo(Math.max(0, secondsAgo))}`;
}

export function takeoverCopy(view: TakeoverView, bookTitle: string): TakeoverCopy {
  switch (view.kind) {
    case 'prompt':
      return promptCopy(view, bookTitle);
    case 'pending':
      return pendingCopy(view);
    case 'failed':
      return failedCopy(view);
  }
}

function promptCopy(view: Extract<TakeoverView, { kind: 'prompt' }>, bookTitle: string) {
  const name = deviceName(view.device);
  const maybeOffline =
    view.secondsSinceActive != null && view.secondsSinceActive > MAY_BE_OFFLINE_AFTER_SECONDS;
  const help = maybeOffline
    ? `${capitalize(name)} hasn’t been active for a while and may be offline. If you continue here, it will pause when it next connects.`
    : `If you continue here, ${name} will pause. Your place moves with you.`;

  return {
    title: 'Continue on this device?',
    body: `${bookTitle} is open on ${name}.`,
    lastActive: lastActiveLabel(view.secondsSinceActive),
    savedPlace: view.position,
    help,
    primary: 'Continue here',
    secondary: 'Not now',
    announcement: 'Continue on this device?',
    tone: 'default',
  } satisfies TakeoverCopy;
}

function pendingCopy(view: Extract<TakeoverView, { kind: 'pending' }>) {
  const name = deviceName(view.device);
  const restoring = view.step === 'restore';
  const steps: TakeoverStep[] = [
    { label: 'Asking your server to switch devices', state: restoring ? 'done' : 'now' },
    { label: 'Opening your saved place', state: restoring ? 'now' : 'wait' },
  ];

  return {
    title: 'Moving your place here…',
    body: `Keep this page open. ${capitalize(name)} will pause once your server confirms.`,
    steps,
    footnote: view.slow ? 'Taking longer than usual.' : 'This usually takes a few seconds.',
    secondary: view.slow ? 'Cancel' : undefined,
    announcement: restoring ? 'Opening your saved place.' : 'Moving your place here.',
    tone: 'default',
  } satisfies TakeoverCopy;
}

function failedCopy(view: Extract<TakeoverView, { kind: 'failed' }>) {
  const name = deviceName(view.device);

  if (view.reason === 'unreachable' || view.reason === 'refused') {
    const cause =
      view.reason === 'unreachable'
        ? 'Aldus couldn’t reach your server'
        : 'Your server didn’t switch devices';
    return {
      title: 'Couldn’t move your place here',
      body: `${cause}, so ${name} is still active and your saved place hasn’t changed.`,
      primary: 'Try again',
      secondary: 'Not now',
      announcement: 'Couldn’t move your place here.',
      tone: 'error',
    } satisfies TakeoverCopy;
  }

  const body =
    view.reason === 'not-downloaded'
      ? 'This book isn’t downloaded to this device, so your saved place can’t open while you’re offline.'
      : `Your server switched to this device, but Aldus couldn’t open your saved place${view.position ? ` at ${view.position}` : ''}. Progress isn’t being saved yet.`;

  return {
    title: 'This device is active, but your place didn’t open',
    body,
    primary: 'Try again',
    secondary: 'Back to book',
    announcement: 'This device is active, but your place didn’t open.',
    tone: 'error',
  } satisfies TakeoverCopy;
}

export type PausedSurface = 'player' | 'reader';

export function pausedCopy(surface: PausedSurface, device: HandoffDevice) {
  const name = deviceName(device);
  const body =
    surface === 'player'
      ? 'Playback paused here so your place stays accurate. This page is still open, and you are still signed in.'
      : 'This page is still open, and you are still signed in. Page turns are paused until you resume.';

  return {
    title: `Continued on ${name}`,
    body,
    action: 'Resume here',
    /** Shown beside disabled controls so they never look merely broken. */
    reason: `Paused — continued on ${name}`,
    announcement: `Continued on ${name}. ${surface === 'player' ? 'Playback paused.' : 'Page turns paused.'}`,
  };
}

export type SavedPlaceOption = {
  id: 'this-device' | 'other-device';
  device: HandoffDevice;
  position: string;
  /** When it was saved, already worded, e.g. "Saved offline today at 9:41 PM". */
  savedLabel: string;
};

export function conflictCopy(otherDevice: HandoffDevice) {
  const name = deviceName(otherDevice);

  return {
    title: 'Two saved places',
    body: `This device and ${name} have different saved places. Choose where to continue. Aldus keeps both places until you decide.`,
    help: 'Choose a place to continue.',
    groupLabel: 'Saved places',
    primary: 'Continue from selected place',
    secondary: 'Decide later',
  };
}

export function savedPlaceName(option: SavedPlaceOption) {
  return option.id === 'this-device' ? 'This device' : capitalize(deviceName(option.device));
}

export const OFFLINE_NOTICE =
  'You’re offline. Progress is saved on this device and uploads when you reconnect. Switching devices needs a connection.';

export type SaveStatusState = 'saving' | 'saved' | 'on-device' | 'error' | 'paused';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type StatusView = {
  label: string;
  tone: StatusTone;
  icon?: 'check' | 'cloudUpload' | 'error' | 'warning';
};

/** Extends the existing save labels with where the place lives: this device or the server. */
export function saveStatusView(state: SaveStatusState, mode: 'read' | 'listen'): StatusView {
  switch (state) {
    case 'saving':
      return { label: 'Saving…', tone: 'neutral' };
    case 'saved':
      return mode === 'listen'
        ? { label: 'Progress saves automatically', tone: 'neutral' }
        : { label: 'Reading place saved', tone: 'success', icon: 'check' };
    case 'on-device':
      return {
        label: 'Saved on this device · Waiting to upload',
        tone: 'neutral',
        icon: 'cloudUpload',
      };
    case 'error':
      return { label: 'Couldn’t save', tone: 'danger', icon: 'error' };
    case 'paused':
      return { label: 'Not saving progress', tone: 'warning', icon: 'warning' };
  }
}

export type SyncReadinessState = 'preparing' | 'ready' | 'separate';

export type SyncReadinessView = {
  label: string;
  tone: StatusTone;
  icon: 'scan' | 'synced' | 'linkOff';
};

/** Whether ebook and audiobook can follow each other. Says nothing about which device is active. */
export function syncReadinessView(state: SyncReadinessState): SyncReadinessView {
  switch (state) {
    case 'preparing':
      return {
        label: 'Preparing ebook and audiobook synchronization',
        tone: 'info',
        icon: 'scan',
      };
    case 'ready':
      return {
        label: 'Ready for synchronized reading and listening',
        tone: 'success',
        icon: 'synced',
      };
    case 'separate':
      return {
        label:
          'No synchronization for this pairing. Switching opens the other format at its own saved place.',
        tone: 'neutral',
        icon: 'linkOff',
      };
  }
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
