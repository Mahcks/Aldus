import type { CanonicalPosition } from '@/generated/api';
import type { RepresentationConflict } from '@/lib/offline-library';
import { formatAudioTime } from './consumption';
import type { HandoffPlatform, SavedPlaceOption } from './handoff-copy';
import type { ProgressConflict } from './reading-conflict';

function savedLabel(prefix: string, timestamp?: string) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return prefix;
  return `${prefix} · ${new Date(timestamp).toLocaleString()}`;
}

export function conflictPlaceOptions(
  progress: ProgressConflict | undefined,
  edition: RepresentationConflict | undefined,
  segments: readonly { id: string; text: string }[],
  platform: HandoffPlatform,
): SavedPlaceOption[] {
  function passage(position: CanonicalPosition, fallback: string) {
    return (
      segments.find((segment) => segment.id === position.segment_id)?.text.slice(0, 120) || fallback
    );
  }
  return (['this-device', 'other-device'] as const).map((id) => {
    const local = id === 'this-device';
    const canonical = local ? progress?.local : progress?.remote;
    const state = progress ? undefined : local ? edition?.local : edition?.remote;
    const exists = Boolean(canonical || state);
    let position = local ? 'Your saved page on this device' : 'The saved page on your server';
    if (!local && !exists) position = 'No saved place on your server · Start at the beginning';
    else if (canonical)
      position = passage(
        canonical,
        local ? 'Your saved reading place' : 'The saved reading place on your server',
      );
    else if (!progress && edition?.kind === 'audio')
      position = formatAudioTime((state?.audio_timestamp_ms ?? 0) / 1000);
    return {
      id,
      device: local ? { platform } : { label: 'your server', platform: 'other' },
      position,
      savedLabel: savedLabel(
        local ? 'Kept on this device' : exists ? 'Saved on your server' : 'No server save yet',
        canonical?.updated_at ?? state?.updated_at,
      ),
    };
  });
}
