import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { CanonicalPosition } from '@/generated/api';
import { queueTask } from './consumption';

// Exercise the screen's actual save functions without loading the native UI.
const screen = readFileSync(new URL('../app/(app)/consume/[id].tsx', import.meta.url), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
test('restoring an EPUB never rewrites its saved edition position', async () => {
  const source = transpiler.transformSync(
    screen.slice(
      screen.indexOf('  async function saveEPUBLocation('),
      screen.indexOf('  async function saveCanonical('),
    ),
  );
  // Only the input guard is available: reaching persistence or UI state is a failure.
  const save = new Function('readerInputBlocked', `${source}; return saveEPUBLocation;`)({
    current: false,
  });
  expect(await save({ href: 'chapter.xhtml', cfi: 'opening-page', reason: 'restore' })).toBe(false);
});

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

function harness(
  options: { conflict?: boolean; offline?: boolean; cached?: CanonicalPosition } = {},
) {
  const writes: string[] = [];
  const expectedRevisions: number[] = [];
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
    saveWorkProgress: async (
      _work: string,
      update: { segment_id: string; expected_revision: number },
    ) => {
      writes.push(update.segment_id);
      expectedRevisions.push(update.expected_revision);
      if (options.conflict) throw new APIError(409);
      if (options.offline) {
        queued.push(update.segment_id);
        return null;
      }
      return position(update.segment_id, progress.current.revision! + 1);
    },
    pendingProgress: async () => (queued.length ? position(queued.at(-1)!) : null),
    offlineWork: async () => (options.cached ? { progress: options.cached } : undefined),
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
    }) => Promise<'saved' | 'offline' | false>;
    saveCanonical: (value: CanonicalPosition) => Promise<'saved' | 'offline' | false>;
  };
  return { ...saves, context, writes, expectedRevisions, confirmations, states, progress, queued };
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
  expect(await reader.saveReadingCursor(selection('saved-offline'))).toBe('offline');
  await reader.saveReadingCursor(selection('saved-offline'));
  expect(reader.queued).toEqual(['saved-offline']);
  expect(reader.confirmations).toEqual([
    { cfi: 'saved-offline', result: 'offline' },
    { cfi: 'saved-offline', result: 'offline' },
  ]);
});

test('canonical saves adopt only an acknowledgment for the exact place already held', async () => {
  for (const cached of [
    position('initial', 5),
    position('another-place', 5),
    { ...position('initial', 5), offset: 500000 },
    { ...position('initial', 5), alignment_id: 'another-alignment' },
    position('initial', 0),
  ]) {
    const reader = harness({ cached });
    expect(await reader.saveReadingCursor(selection('next-place'))).toBe('saved');
    const acknowledged =
      cached.alignment_id === 'alignment' &&
      cached.segment_id === 'initial' &&
      cached.offset === 0 &&
      cached.revision === 5;
    expect(reader.expectedRevisions).toEqual([acknowledged ? 5 : 1]);
    expect(reader.writes).toEqual(['next-place']);
    expect(reader.progress.current.segment_id).toBe('next-place');
  }
});

function navigationHarness(reason = 'explicit', aligned = false, mode = 'read') {
  const source = transpiler.transformSync(
    screen.slice(
      screen.indexOf('  async function leaveReader('),
      screen.indexOf('  async function switchToRead('),
    ) +
      screen.slice(
        screen.indexOf('  async function handleReadMode('),
        screen.indexOf('  async function toggleAcceptanceNetwork('),
      ),
  );
  const calls: string[] = [];
  const persistence = {
    epub: async () => true,
    canonical: async (): Promise<'saved' | 'offline' | false> => 'saved',
    audio: async () => true,
  };
  const leaving = { current: false };
  const context = {
    leaving,
    switching: { current: false },
    mode,
    readerLocation: {
      href: 'chapter.xhtml',
      cfi: 'latest',
      reason,
      sync: aligned ? {} : undefined,
    },
    selectedEPUB: { id: 'epub' },
    selectedAudio: mode === 'listen' ? { id: 'audio' } : undefined,
    status: { isLoaded: true },
    player: { currentTime: 45 },
    lastAudioSave: { current: 0 },
    alignmentID: aligned ? 'alignment' : undefined,
    readerInputBlocked: { current: false },
    formatSwitchBusy: false,
    canonicalSaves: { current: Promise.resolve() },
    representationSaves: { current: Promise.resolve() },
    audioSaves: { current: Promise.resolve() },
    pendingAudioHandoff: { current: undefined },
    params: { id: 'book' },
    commitsReadingProgress: (value: string) => value === 'explicit' || value === 'forward',
    saveEPUBLocation: async () => {
      calls.push('save-epub');
      return persistence.epub();
    },
    saveReadingCursor: async () => {
      calls.push('save-canonical');
      return persistence.canonical();
    },
    saveListeningPosition: async (timestamp: number) => {
      expect(timestamp).toBe(45000);
      calls.push('save-audio');
      return persistence.audio();
    },
    goBackOr: () => calls.push('close'),
    setMode: (value: string) => calls.push(value),
    setSettingsOpen: () => {},
    setModeSwitching: () => {},
    setNotice: () => {},
    errorMessage: (error: Error) => error.message,
    switchToListen: async () => calls.push('handoff'),
    switchToRead: async () => calls.push('handoff'),
  };
  const create = new Function(
    ...Object.keys(context),
    `${source}; return { leaveReader, handleListenMode, handleReadMode };`,
  );
  const actions = create(...Object.values(context)) as {
    leaveReader: () => Promise<void>;
    handleListenMode: () => Promise<void>;
    handleReadMode: () => Promise<void>;
  };
  return { ...actions, calls, persistence, leaving };
}

test('closing stays in the reader after an edition save fails and permits retry', async () => {
  const reader = navigationHarness();
  reader.persistence.epub = async () => false;
  await reader.leaveReader();
  expect(reader.calls).toEqual(['save-epub']);
  expect(reader.leaving.current).toBe(false);

  reader.persistence.epub = async () => true;
  await reader.leaveReader();
  expect(reader.calls.at(-1)).toBe('close');
});

test('closing waits for a successful canonical save when the selected place is aligned', async () => {
  const reader = navigationHarness('explicit', true);
  reader.persistence.canonical = async () => false;
  await reader.leaveReader();
  expect(reader.calls).toEqual(['save-epub', 'save-canonical']);
  expect(reader.leaving.current).toBe(false);

  reader.persistence.canonical = async () => 'offline';
  await reader.leaveReader();
  expect(reader.calls.at(-1)).toBe('close');
});

test('a restored place can close without attempting another save', async () => {
  const reader = navigationHarness('restore', true);
  reader.persistence.epub = async () => false;
  await reader.leaveReader();
  expect(reader.calls).toEqual(['close']);
});

test('switching an unaligned reader to listening waits for its latest page to persist', async () => {
  const reader = navigationHarness('relocate');
  let finish!: (saved: boolean) => void;
  reader.persistence.epub = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const switching = reader.handleListenMode();
  expect(reader.calls).toEqual(['save-epub']);
  finish(true);
  await switching;
  expect(reader.calls).toEqual(['save-epub', 'listen']);
});

test('failed fallback mode-switch saves keep the reader open', async () => {
  const reader = navigationHarness('relocate');
  reader.persistence.epub = async () => false;
  await reader.handleListenMode();
  expect(reader.calls).toEqual(['save-epub']);
});

test('audio exits wait for persistence and stay open on failure', async () => {
  for (const action of ['leaveReader', 'handleReadMode'] as const) {
    const reader = navigationHarness('relocate', false, 'listen');
    reader.persistence.audio = async () => false;
    await reader[action]();
    expect(reader.calls).toEqual(['save-audio']);
    expect(reader.leaving.current).toBe(false);

    let finish!: (saved: boolean) => void;
    reader.persistence.audio = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const exiting = reader[action]();
    expect(reader.calls).toEqual(['save-audio', 'save-audio']);
    finish(true);
    await exiting;
    expect(reader.calls.at(-1)).toBe(action === 'leaveReader' ? 'close' : 'read');
  }
});

test('audio save success requires durable edition and aligned canonical progress', async () => {
  const source = transpiler.transformSync(
    screen.slice(
      screen.indexOf('  async function saveListeningPosition('),
      screen.indexOf('  async function switchToListen('),
    ),
  );
  for (const scenario of [
    'edition-failed',
    'canonical-failed',
    'saved',
    'offline',
    'unaligned',
    'mapping-failed',
  ]) {
    const calls: string[] = [];
    const context = {
      status: { playbackRate: 1 },
      switching: { current: false },
      alignmentID: scenario === 'unaligned' ? undefined : 'alignment',
      alignment: { segments: [{ audio_resource: 'narration.mp3' }] },
      audioSaves: { current: Promise.resolve() },
      queueTask,
      isCurrentReader: () => true,
      saveRepresentation: async () => {
        calls.push('edition');
        return scenario === 'edition-failed'
          ? 'error'
          : scenario === 'offline'
            ? 'offline'
            : 'saved';
      },
      api: {
        audioToCanonical: async () => {
          calls.push('mapping');
          if (scenario === 'offline') throw new APIError(0);
          if (scenario === 'mapping-failed') throw new APIError(404);
          return position('latest');
        },
      },
      offlineAudioToCanonical: () => position('latest'),
      saveCanonical: async () => {
        calls.push('canonical');
        return scenario === 'canonical-failed'
          ? false
          : scenario === 'offline'
            ? 'offline'
            : 'saved';
      },
      APIError,
      setSyncAvailable: () => {},
      setNotice: () => {},
      errorMessage: (error: Error) => error.message,
    };
    const create = new Function(
      ...Object.keys(context),
      `${source}; return saveListeningPosition;`,
    );
    const save = create(...Object.values(context)) as (timestamp: number) => Promise<boolean>;
    expect(await save(45000)).toBe(['saved', 'offline', 'unaligned'].includes(scenario));
    expect(calls).toEqual(
      ['edition-failed', 'unaligned'].includes(scenario)
        ? ['edition']
        : scenario === 'mapping-failed'
          ? ['edition', 'mapping']
          : ['edition', 'mapping', 'canonical'],
    );
  }
});

test('remote target conversion cannot restore over a newer reading or listening save', async () => {
  const start = screen.indexOf('    async function refreshProgress(');
  const source = transpiler.transformSync(
    screen.slice(start, screen.indexOf('    const subscription =', start)),
  );
  for (const mode of ['read', 'listen']) {
    for (const change of ['unchanged', 'queued-save', 'new-progress']) {
      let finishMapping!: (target: { timestamp_ms: number }) => void;
      let mappingStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        mappingStarted = resolve;
      });
      const target = new Promise<{ timestamp_ms: number }>((resolve) => {
        finishMapping = resolve;
      });
      const mapTarget = async () => {
        mappingStarted();
        return target;
      };
      const canonicalSaves = { current: Promise.resolve() };
      const progress = { current: position('initial', 1) };
      const restored: unknown[] = [];
      const notices: string[] = [];
      const context = {
        active: true,
        refreshing: false,
        switching: { current: false },
        canonicalSaves,
        representationSaves: { current: Promise.resolve() },
        audioSaves: { current: Promise.resolve() },
        editionConflictRef: { current: undefined },
        progressConflictRef: { current: undefined },
        workID: 'book',
        mode,
        alignmentID: 'alignment',
        reconcileOfflineRepresentationStates: async () => [],
        reconcilePendingProgress: async () => null,
        isCurrentReader: () => true,
        api: {
          workProgress: async () => ({ ...position('remote', 2), resolvable: true }),
          canonicalToEPUB: mapTarget,
          canonicalToAudio: mapTarget,
        },
        progressRef: progress,
        setProgress: () => {},
        queueReaderRestore: (value: unknown) => restored.push(value),
        restoredAudio: { current: 'previous' },
        setAudioReady: () => {},
        setInitialAudioMS: (value: unknown) => restored.push(value),
        setSyncAvailable: () => {},
        setResumeMessage: () => {},
        resumedProgressLabel: () => 'Restored',
        APIError,
        setNotice: (value: string) => notices.push(value),
        errorMessage: (error: Error) => error.message,
      };
      const create = new Function(...Object.keys(context), `${source}; return refreshProgress;`);
      const refresh = create(...Object.values(context)) as () => Promise<void>;
      const refreshing = refresh();
      await started;
      if (change === 'queued-save') canonicalSaves.current = Promise.resolve();
      if (change === 'new-progress') progress.current = position('newer-selection', 3);
      finishMapping({ timestamp_ms: 45000 });
      await refreshing;
      expect(notices).toEqual([]);
      expect(restored).toEqual(
        change === 'unchanged' ? [mode === 'read' ? { timestamp_ms: 45000 } : 45000] : [],
      );
    }
  }
});

test('reopening pending progress keeps its original expected revision', () => {
  const start = screen.indexOf('        const effectiveProgress = pending');
  const source = transpiler.transformSync(
    screen.slice(start, screen.indexOf('        if (canceled) return;', start)),
  );
  const effective = new Function('pending', 'nextProgress', `${source}; return effectiveProgress;`);
  const remote = position('other-device', 8);
  const pending = {
    alignment_id: 'alignment',
    segment_id: 'offline-selection',
    offset: 125000,
    expected_revision: 3,
  };
  expect(effective(pending, remote)).toEqual({
    ...remote,
    segment_id: pending.segment_id,
    offset: pending.offset,
    revision: pending.expected_revision,
  });
  expect(effective(null, remote)).toBe(remote);
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
      'no-manifest',
      'storage-failed',
    ] as const) {
      const foreignConflict = scenario === 'foreign-conflict';
      let activeAccount = true;
      const calls: string[] = [];
      let requestStarted!: () => void;
      let finishRequest!: () => void;
      const started = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      const response = new Promise<void>((resolve) => {
        finishRequest = resolve;
      });
      let stagedState: unknown;
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
        readerScope: 'account',
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
            requestStarted();
            await response;
            return { ...acknowledged, revision: 3 };
          },
          representationState: async () => {
            throw new Error('Must not adopt an arbitrary server revision');
          },
        },
        updateOfflineRepresentationState: async (
          _workID: string,
          stateKind: string,
          state: unknown,
          pending: boolean,
          scope: string,
        ) => {
          expect(stateKind).toBe(kind);
          expect(scope).toBe('account');
          calls.push(pending ? 'cache-pending' : 'cache-saved');
          if (scenario === 'storage-failed') throw new Error('Storage unavailable');
          if (pending) stagedState = state;
          return scenario !== 'no-manifest';
        },
        acknowledgeOfflineRepresentationState: async (
          _workID: string,
          stateKind: string,
          submitted: unknown,
          saved: { revision: number },
          rebaseNewer: boolean,
          scope: string,
        ) => {
          expect(stateKind).toBe(kind);
          expect(submitted).toBe(stagedState);
          expect(saved.revision).toBe(3);
          expect(rebaseNewer).toBe(true);
          expect(scope).toBe('account');
          calls.push('acknowledged');
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
      const saving = save(kind, kind === 'epub' ? latest : 123000);
      if (!['account-changed', 'foreign-conflict', 'storage-failed'].includes(scenario)) {
        await started;
        expect(calls).toEqual(['replay', 'cache', 'cache-pending', 'put']);
        expect(stagedState).toMatchObject(
          kind === 'epub' ? { epub_locator: latest } : { audio_timestamp_ms: 123000 },
        );
        finishRequest();
      }
      const result = await saving;
      if (scenario === 'account-changed') {
        expect(result).toBe('error');
        expect(calls).toEqual(['replay']);
      } else if (scenario === 'storage-failed') {
        expect(result).toBe('error');
        expect(calls).toEqual(['replay', 'cache', 'cache-pending']);
      } else {
        expect(result).toBe(foreignConflict ? 'error' : 'saved');
        expect(calls).toEqual(
          foreignConflict
            ? ['replay', 'conflict']
            : [
                'replay',
                'cache',
                'cache-pending',
                'put',
                scenario === 'no-manifest' ? 'cache-saved' : 'acknowledged',
              ],
        );
      }
    }
  }
});
