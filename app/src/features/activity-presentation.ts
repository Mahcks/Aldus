import type { TitleRequest } from '../generated/api';

export type RequestFilter = 'active' | 'ready' | 'history';

const terminalStates = new Set(['available', 'denied', 'canceled', 'failed']);

export function isActiveRequestState(state: string) {
  return !terminalStates.has(state);
}

export function isCancelableRequestState(state: string) {
  return [
    'pending_approval',
    'wanted',
    'searching',
    'awaiting_release',
    'submitting',
    'downloading',
  ].includes(state);
}

export function requestGroup(request: TitleRequest): RequestFilter {
  if (request.formats.some((format) => isActiveRequestState(format.state))) return 'active';
  if (request.formats.some((format) => format.state === 'available')) return 'ready';
  return 'history';
}

export function isTakingLonger(state: string, updatedAt: string, now = Date.now()) {
  return state === 'downloading' && now - new Date(updatedAt).getTime() > 24 * 60 * 60 * 1000;
}
