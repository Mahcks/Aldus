import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { CanonicalPosition } from '@/generated/api';

// Exercise the screen's actual save functions without loading the native UI.
const screen = readFileSync(new URL('../app/(app)/consume/[id].tsx', import.meta.url), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const functions = transpiler.transformSync(
  screen.slice(
    screen.indexOf('  async function saveCanonical('),
    screen.indexOf('  async function restoreCanonical('),
  ) +
    screen.slice(
      screen.indexOf('  async function saveReadingCursor('),
      screen.indexOf('  async function saveListeningPosition('),
    ),
);

class APIError extends Error {
  constructor(public status: number) {
    super('Request failed');
  }
}

function position(segment: string, revision = 1): CanonicalPosition {
  return { alignment_id: 'alignment', segment_id: segment, offset: 0, revision };
}

function harness(options: { conflict?: boolean; offline?: boolean } = {}) {
  const writes: string[] = [];
  const confirmations: { cfi: string; result: string }[] = [];
  const states: string[] = [];
  const progress = { current: position('initial') };
  const conflict = { current: undefined as unknown };
  const queued: string[] = [];
  const context = {
    work: { id: 'book' },
    alignmentID: 'alignment',
    readerScope: 'account',
    readerOrigin: 'server',
    activeStorageScope: () => 'account',
    getAPIBaseURL: () => 'server',
    isCurrentReader: () => true,
    progressConflictRef: conflict,
    editionConflictRef: { current: undefined },
    progressRef: progress,
    canonicalSaves: { current: Promise.resolve() },
    saveAttempt: { current: 0 },
    readerInputBlocked: { current: false },
    switching: { current: false },
    reader: {
      current: {
        confirmSavedPlace: (location: { cfi: string }, result: string) =>
          confirmations.push({ cfi: location.cfi, result }),
      },
    },
    commitsReadingProgress: (reason: string) => reason === 'explicit',
    api: {
      epubToCanonical: async (_alignment: string, locator: { href: string }) =>
        position(locator.href),
      workProgress: async () => position('other-device', 10),
    },
    saveWorkProgress: async (_work: string, update: { segment_id: string }) => {
      writes.push(update.segment_id);
      if (options.conflict) throw new APIError(409);
      if (options.offline) {
        queued.push(update.segment_id);
        return null;
      }
      return position(update.segment_id, progress.current.revision! + 1);
    },
    pendingProgress: async () => (queued.length ? position(queued.at(-1)!) : null),
    updateOfflineProgress: async () => {},
    setProgress: () => {},
    setSaveState: (value: string) => states.push(value),
    updateProgressConflict: (value: unknown) => {
      conflict.current = value;
    },
    setSyncAvailable: () => {},
    setResumeMessage: () => {},
    setNotice: () => {},
    setAcceptanceNetworkState: () => {},
    offlineEPUBToCanonical: (_alignment: string, locator: { href: string }) =>
      position(locator.href),
    APIError,
    errorMessage: (error: Error) => error.message,
    Platform: { OS: 'ios' },
  };
  const create = new Function(
    ...Object.keys(context),
    `${functions}; return { saveReadingCursor, saveCanonical };`,
  );
  const saves = create(...Object.values(context)) as {
    saveReadingCursor: (location: {
      cfi: string;
      reason: string;
      sync: { href: string };
    }) => Promise<void>;
    saveCanonical: (value: CanonicalPosition) => Promise<'saved' | 'offline' | false>;
  };
  return { ...saves, context, writes, confirmations, states, progress, queued };
}

const selection = (id: string) => ({ cfi: id, reason: 'explicit', sync: { href: id } });

test('a slow earlier lookup cannot overwrite a newer selected reading place', async () => {
  const reader = harness();
  let finishFirst!: (value: CanonicalPosition) => void;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const first = new Promise<CanonicalPosition>((resolve) => {
    finishFirst = resolve;
  });
  const lookups: string[] = [];
  reader.context.api.epubToCanonical = async (_alignment, locator) => {
    lookups.push(locator.href);
    if (locator.href === 'earlier') {
      firstStarted();
      return first;
    }
    return position(locator.href);
  };
  const earlier = reader.saveReadingCursor(selection('earlier'));
  await started;
  const latest = reader.saveReadingCursor(selection('latest'));
  expect(reader.writes).toEqual([]);
  expect(lookups).toEqual(['earlier']);
  finishFirst(position('earlier'));
  await Promise.all([earlier, latest]);
  expect(reader.writes).toEqual(['earlier', 'latest']);
  expect(reader.progress.current.segment_id).toBe('latest');
  expect(reader.confirmations.at(-1)).toEqual({ cfi: 'latest', result: 'saved' });
});

test('a conflict blocks already queued and subsequent saves until the user chooses', async () => {
  const reader = harness({ conflict: true });
  await Promise.all([
    reader.saveReadingCursor(selection('first')),
    reader.saveReadingCursor(selection('second')),
  ]);
  await reader.saveReadingCursor(selection('third'));
  expect(reader.writes).toEqual(['first']);
  expect(reader.progress.current.segment_id).toBe('other-device');
  expect(reader.confirmations).toEqual([]);
});

test('offline selection confirmation follows durable queueing, including the same place again', async () => {
  const reader = harness({ offline: true });
  await reader.saveReadingCursor(selection('saved-offline'));
  await reader.saveReadingCursor(selection('saved-offline'));
  expect(reader.queued).toEqual(['saved-offline']);
  expect(reader.confirmations).toEqual([
    { cfi: 'saved-offline', result: 'offline' },
    { cfi: 'saved-offline', result: 'offline' },
  ]);
});

test('foreground edition saves use their own acknowledged replay revision and stop on foreign conflicts', async () => {
  const source = transpiler.transformSync(
    screen.slice(
      screen.indexOf('  async function saveRepresentation('),
      screen.indexOf('  async function saveEPUBLocation('),
    ),
  );
  for (const kind of ['epub', 'audio'] as const) {
    for (const scenario of [
      'own-replay',
      'foreign-conflict',
      'unrelated-edition',
      'account-changed',
    ] as const) {
      const foreignConflict = scenario === 'foreign-conflict';
      let activeAccount = true;
      const calls: string[] = [];
      const older = { representation_id: 'edition', revision: 1 };
      const acknowledged = {
        ...older,
        representation_id: scenario === 'unrelated-edition' ? 'another-edition' : 'edition',
        revision: 2,
      };
      const latest = { href: 'chapter-3.xhtml', cfi: 'selected-sentence' };
      const conflict = {
        workID: 'book',
        kind,
        local: older,
        remote: { ...older, revision: 10 },
      };
      const context = {
        selectedEPUB: { representation: { id: 'edition' } },
        selectedAudio: { representation: { id: 'edition' } },
        work: { id: 'book' },
        status: { playbackRate: 1 },
        readerPreferences: { layout: 'paginated' },
        epubStateRef: { current: older },
        audioStateRef: { current: older },
        editionConflictRef: { current: undefined },
        isCurrentReader: () => activeAccount,
        Platform: { OS: 'ios' },
        reconcileOfflineRepresentationStates: async () => {
          calls.push('replay');
          if (scenario === 'account-changed') activeAccount = false;
          return foreignConflict ? [conflict] : [];
        },
        offlineWork: async () => {
          calls.push('cache');
          return { epub_state: acknowledged, audio_state: acknowledged };
        },
        showEditionConflict: (value: unknown) => {
          expect(value).toBe(conflict);
          calls.push('conflict');
        },
        api: {
          updateRepresentationState: async (
            _id: string,
            update: {
              expected_revision: number;
              epub_locator?: unknown;
              audio_timestamp_ms?: number;
            },
          ) => {
            calls.push('put');
            expect(update.expected_revision).toBe(scenario === 'unrelated-edition' ? 1 : 2);
            if (kind === 'epub') expect(update.epub_locator).toEqual(latest);
            else expect(update.audio_timestamp_ms).toBe(123000);
            return { ...acknowledged, revision: 3 };
          },
          representationState: async () => {
            throw new Error('Must not adopt an arbitrary server revision');
          },
        },
        updateOfflineRepresentationState: async () => {
          calls.push('cache-saved');
          return true;
        },
        setEPUBState: () => {},
        setAudioState: () => {},
        setNotice: () => {},
        APIError,
        errorMessage: (error: Error) => error.message,
      };
      const create = new Function(...Object.keys(context), `${source}; return saveRepresentation;`);
      const save = create(...Object.values(context)) as (
        kind: 'epub' | 'audio',
        value: unknown,
      ) => Promise<string>;
      const result = await save(kind, kind === 'epub' ? latest : 123000);
      if (scenario === 'account-changed') {
        expect(result).toBe('error');
        expect(calls).toEqual(['replay']);
      } else {
        expect(result).toBe(foreignConflict ? 'error' : 'saved');
        expect(calls).toEqual(
          foreignConflict ? ['replay', 'conflict'] : ['replay', 'cache', 'put', 'cache-saved'],
        );
      }
    }
  }
});
