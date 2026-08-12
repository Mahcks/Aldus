import { Platform } from 'react-native';

import type { Alignment, AudioLocator, CanonicalPosition, EPUBLocator } from '../types/sync';

const baseURL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'http://localhost:8080');
const alignmentID = 'fixture-alignment';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseURL}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export function getAlignment() {
  return request<Alignment>(`/alignments/${alignmentID}`);
}

export async function getProgress() {
  const response = await fetch(`${baseURL}/api/alignments/${alignmentID}/progress`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<CanonicalPosition>;
}

export function epubToCanonical(locator: EPUBLocator) {
  return request<CanonicalPosition>(`/alignments/${alignmentID}/resolve/epub`, {
    method: 'POST',
    body: JSON.stringify(locator),
  });
}

export function audioToCanonical(locator: AudioLocator) {
  return request<CanonicalPosition>(`/alignments/${alignmentID}/resolve/audio`, {
    method: 'POST',
    body: JSON.stringify(locator),
  });
}

export function canonicalToEPUB(position: CanonicalPosition) {
  return request<EPUBLocator>(`/alignments/${alignmentID}/locators/epub`, {
    method: 'POST',
    body: JSON.stringify(position),
  });
}

export function canonicalToAudio(position: CanonicalPosition) {
  return request<AudioLocator>(`/alignments/${alignmentID}/locators/audio`, {
    method: 'POST',
    body: JSON.stringify(position),
  });
}

export async function updateProgress(position: CanonicalPosition, expectedRevision: number, sourceDevice: string) {
  const response = await fetch(`${baseURL}/api/alignments/${alignmentID}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segment_id: position.segment_id,
      offset: position.offset,
      expected_revision: expectedRevision,
      source_device: sourceDevice,
    }),
  });
  const current = (await response.json()) as CanonicalPosition;
  if (response.status === 409) return { current, conflict: true };
  if (!response.ok) throw new Error(`${response.status}`);
  return { current, conflict: false };
}
