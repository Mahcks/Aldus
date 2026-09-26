import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { CanonicalPosition } from '@/generated/api';
import { queueTask, pendingCanonicalProgress } from './consumption';

// Exercise the actual save functions without loading the native UI.
const screen = ['useConsumptionActions', 'useConsumptionSync']
  .map((name) =>
    readFileSync(new URL(`../../hooks/consumption/${name}.ts`, import.meta.url), 'utf8'),
  )
  .join('\n');
const canonicalProgress = readFileSync(
  new URL('../../hooks/consumption/useCanonicalProgress.ts', import.meta.url),
  'utf8',
);

// Locate declarations by name so moving a neighboring function cannot change a test's subject.
function functionSource(name: string, source = screen): string {
  const file = ts.createSourceFile(
    'subject.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function find(node: ts.Node): ts.FunctionDeclaration | undefined {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node;
    return ts.forEachChild(node, find);
  }
  const declaration = find(file);
  if (!declaration) throw new Error(`Missing function: ${name}`);
  // The sync hook uses explicit Ref names; the existing harness keeps its original bindings.
  return declaration
    .getText(file)
    .replace(
      /\b(epubSourceID|audioSourceID|restoredAudio|pendingAudioHandoff|lastAudioSave|representationSaves|audioSaves|representationSaveAttempt|switching|leaving|canonicalSaves|readerInputBlocked)Ref\b/g,
      '$1',
    );
}

const representationProgress = readFileSync(
  new URL('../../hooks/consumption/useRepresentationProgress.ts', import.meta.url),
  'utf8',
);
const transpiler = new Bun.Transpiler({ loader: 'ts' });
test('restoring an EPUB never rewrites its saved edition position', async () => {
  const source = transpiler.transformSync(functionSource('saveEPUBLocation'));
  // Only the input guard is available: reaching persistence or UI state is a failure.
  const save = new Function('readerInputBlocked', `${source}; return saveEPUBLocation;`)({
    current: false,
  });
  expect(await save({ href: 'chapter.xhtml', cfi: 'opening-page', reason: 'restore' })).toBe(false);
});

const functions = transpiler.transformSync(
  functionSource('saveCanonical', canonicalProgress) + functionSource('saveReadingCursor'),
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
    maySaveReadingPosition: () => true,
    readingProofForWork: () => undefined,
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
    acceptanceNetwork: { markQueued: () => {} },
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
  expect(reader.progress.current.segment_id).toBe('initial');
  expect(reader.context.progressConflictRef.current).toMatchObject({
    local: { segment_id: 'first' },
    remote: { segment_id: 'other-device' },
  });
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
    functionSource('leaveReader') +
      functionSource('handleReadMode') +
      functionSource('handleListenMode'),
  );
  const calls: string[] = [];
  const persistence = {
    epub: async () => true,
    canonical: async (): Promise<'saved' | 'offline' | false> => 'saved',
    audio: async () => true,
  };
  const leaving = { current: false };
  const ownership = { writable: true };
  const switching = { current: false };
  const context = {
    leaving,
    switching,
    exited: { current: false },
    maySaveReadingPosition: () => ownership.writable,
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
    player: { currentTime: 45, pause: () => {} },
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
  return { ...actions, calls, persistence, leaving, ownership, switching };
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
  const source = transpiler.transformSync(functionSource('saveListeningPosition'));
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

test('progress refresh preserves the visible place and checks ownership before offering a conflict', async () => {
  const source = transpiler.transformSync(functionSource('refreshProgress'));
  for (const mode of ['read', 'listen']) {
    for (const change of [
      'unchanged',
      'queued-save',
      'new-progress',
      'lost-ownership',
      'save-during-owner-check',
    ]) {
      let release!: () => void;
      let started!: () => void;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      const canonicalSaves = { current: Promise.resolve() };
      const progress = { current: position('initial', 1) };
      const conflicts: unknown[] = [];
      let owns = true;
      let ownershipChecks = 0;
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
        checkOwnership: async () => {
          ownershipChecks++;
          if (change === 'save-during-owner-check' && ownershipChecks === 2) {
            canonicalSaves.current = Promise.resolve();
            progress.current = position('newer-selection', 3);
          }
          return owns;
        },
        reconcileOfflineRepresentationStates: async () => [],
        reconcilePendingProgress: async () => null,
        isCurrentReader: () => true,
        api: {
          workProgress: async () => {
            started();
            await response;
            return position('remote', 2);
          },
        },
        progressRef: progress,
        setProgress: () => {
          throw new Error('Must not adopt the other place before a choice');
        },
        updateProgressConflict: (value: unknown) => conflicts.push(value),
        setSaveState: () => {},
        APIError,
        OwnershipSupersededError: class extends Error {},
        setNotice: (value: string) => {
          throw new Error(value);
        },
        errorMessage: (error: Error) => error.message,
      };
      const refresh = new Function(...Object.keys(context), `${source}; return refreshProgress;`)(
        ...Object.values(context),
      );
      const refreshing = refresh();
      await requested;
      if (change === 'queued-save') canonicalSaves.current = Promise.resolve();
      if (change === 'new-progress') progress.current = position('newer-selection', 3);
      if (change === 'lost-ownership') owns = false;
      release();
      await refreshing;
      expect(progress.current.segment_id).toBe(
        change === 'new-progress' || change === 'save-during-owner-check'
          ? 'newer-selection'
          : 'initial',
      );
      expect(conflicts).toHaveLength(change === 'unchanged' ? 1 : 0);
    }
  }
});

test('reopening pending progress keeps its original expected revision', () => {
  const remote = position('other-device', 8);
  const pending = {
    alignment_id: 'alignment',
    segment_id: 'offline-selection',
    offset: 125000,
    expected_revision: 3,
    source_device: 'ios',
  };
  expect(pendingCanonicalProgress(remote, pending)).toEqual({
    ...remote,
    segment_id: pending.segment_id,
    offset: pending.offset,
    revision: pending.expected_revision,
  });
  expect(pendingCanonicalProgress(remote, null)).toBe(remote);
});

test('foreground edition saves use their own acknowledged replay revision and stop on foreign conflicts', async () => {
  const source = transpiler.transformSync(
    functionSource('saveRepresentation', representationProgress),
  );
  for (const kind of ['epub', 'audio'] as const) {
    for (const scenario of [
      'own-replay',
      'foreign-conflict',
      'unrelated-edition',
      'account-changed',
      'no-manifest',
      'storage-failed',
      'ownership-lost-after-save',
    ] as const) {
      const foreignConflict = scenario === 'foreign-conflict';
      let activeAccount = true;
      let ownsBook = true;
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
        serializeEditionSave: (_key: string, save: () => Promise<unknown>) => save(),
        selectedEPUB: { representation: { id: 'edition' } },
        selectedAudio: { representation: { id: 'edition' } },
        work: { id: 'book' },
        readerScope: 'account',
        status: { playbackRate: 1 },
        readerLayout: 'paginated',
        defaultPlaybackSpeed: 1,
        epubStateRef: { current: older },
        audioStateRef: { current: older },
        editionConflictRef: { current: undefined },
        progressConflictRef: { current: undefined },
        maySaveReadingPosition: () => ownsBook,
        readingProofForWork: () => undefined,
        isCurrentReader: () => activeAccount,
        Platform: { OS: 'ios' },
        reconcileOfflineRepresentationStates: async () => {
          calls.push('replay');
          if (scenario === 'account-changed') activeAccount = false;
          return foreignConflict ? [conflict] : [];
        },
        offlineRepresentationState: async () => {
          calls.push('cache');
          return acknowledged;
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
        if (scenario === 'ownership-lost-after-save') ownsBook = false;
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
        expect(result).toBe(
          foreignConflict || scenario === 'ownership-lost-after-save' ? 'error' : 'saved',
        );
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

test('a superseded reader or player can leave during switching without another save', async () => {
  for (const mode of ['read', 'listen']) {
    const reader = navigationHarness('explicit', true, mode);
    reader.ownership.writable = false;
    reader.switching.current = true;
    await Promise.all([reader.leaveReader(), reader.leaveReader(), reader.leaveReader()]);
    expect(reader.calls).toEqual(['close']);
  }
});

test('takeover during an in-flight exit permits Back and never navigates twice', async () => {
  for (const rejects of [false, true]) {
    const reader = navigationHarness('explicit', true);
    let finish!: () => void;
    reader.persistence.epub = () =>
      new Promise((resolve, reject) => {
        finish = () => (rejects ? reject(new Error('superseded')) : resolve(false));
      });
    const pending = reader.leaveReader();
    expect(reader.calls).toEqual(['save-epub']);
    reader.ownership.writable = false;
    await reader.leaveReader();
    expect(reader.calls).toEqual(['save-epub', 'close']);
    finish();
    await pending;
    await reader.leaveReader();
    expect(reader.calls).toEqual(['save-epub', 'close']);
  }
});

test('an active reader does not start a competing exit save during a format switch', async () => {
  const reader = navigationHarness();
  reader.switching.current = true;
  await reader.leaveReader();
  expect(reader.calls).toEqual([]);
  reader.switching.current = false;
  await reader.leaveReader();
  expect(reader.calls).toEqual(['save-epub', 'close']);
});

test('a full selection is kept before canonical I/O and bound only after the exact save succeeds', async () => {
  const { savedSelection } = await import('./resume-selection');
  for (const outcome of [
    'saved',
    'offline',
    'rejected',
    'superseded',
    'queued-superseded',
  ] as const) {
    const events: string[] = [];
    const payloads: any[] = [];
    const p = position('selected', outcome === 'offline' ? 6 : 7);
    let releaseQueue!: () => void;
    const queue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    let epoch = 1;
    const context = {
      readerInputBlocked: { current: false },
      readerScope: 'scope',
      readerOrigin: 'origin',
      representationSaveAttempt: { current: 0 },
      representationSaves: { current: queue },
      alignmentID: 'alignment',
      progressRef: { current: p },
      progressConflictRef: { current: undefined },
      activeStorageScope: () => 'scope',
      getAPIBaseURL: () => 'origin',
      work: { id: 'book' },
      maySaveReadingPosition: () => true,
      readingProofForWork: () => ({
        device_id: 'test',
        epoch: outcome === 'superseded' && events.includes('canonical') ? 2 : epoch,
      }),
      selectedEPUB: { id: 'epub', sha256: 'hash' },
      savedSelection,
      offlineEPUBToCanonical: () => p,
      api: { epubToCanonical: async () => p },
      pendingProgress: async () => (outcome === 'offline' ? { ...p, expected_revision: 6 } : null),
      saveRepresentation: async (_kind: string, value: any) => {
        events.push('edition');
        payloads.push(value);
        return outcome === 'offline' ? 'offline' : 'saved';
      },
      saveCanonical: async (resolve: () => Promise<unknown>) => {
        events.push('canonical');
        await resolve();
        return outcome === 'rejected' ? false : outcome === 'superseded' ? 'saved' : outcome;
      },
      setSaveState: () => {},
      reader: { current: { confirmSavedPlace: () => {} } },
      APIError,
    };
    const save = new Function(
      ...Object.keys(context),
      `${transpiler.transformSync(functionSource('saveEPUBLocation'))}; return saveEPUBLocation;`,
    )(...Object.values(context));
    const saving = save({
      href: 'chapter.xhtml',
      cfi: 'point',
      reason: 'explicit',
      sync: { href: 'chapter.xhtml' },
      selection: { href: 'chapter.xhtml', text: 'The table was large', before: '', after: '' },
    });
    if (outcome === 'queued-superseded') epoch = 2;
    releaseQueue();
    const result = await saving;
    if (outcome === 'queued-superseded') {
      expect(result).toBe(false);
      expect(events).toEqual([]);
      expect(payloads).toEqual([]);
      continue;
    }
    expect(payloads[0].resume_selection.range.text).toBe('The table was large');
    expect(payloads[0].resume_selection.progress.revision).toBe(0);
    if (outcome === 'rejected' || outcome === 'superseded') {
      expect(result).toBe(false);
      expect(events).toEqual(['edition', 'canonical']);
    } else {
      expect(result).toBe(true);
      expect(events).toEqual(['edition', 'canonical', 'edition']);
      expect(payloads[1].resume_selection.progress.revision).toBe(7);
    }
  }
});

test('conflict restoration reveals the saved highlight after native navigation succeeds', async () => {
  const source = transpiler.transformSync(functionSource('restoreEPUBPlace'));
  for (const succeeds of [true, false]) {
    const events: string[] = [];
    const target = { href: 'chapter.xhtml', resume_selection: { range: { text: 'full passage' } } };
    const reader = {
      current: {
        restoreLocation: async (value: unknown, highlight: boolean) => {
          expect(value).toBe(target);
          expect(highlight).toBe(true);
          events.push('restore');
          return succeeds;
        },
        revealRestoredPlace: () => events.push('highlight'),
      },
    };
    const restore = new Function('reader', `${source}; return restoreEPUBPlace;`)(reader);
    expect(await restore(target, true)).toBe(succeeds);
    expect(events).toEqual(succeeds ? ['restore', 'highlight'] : ['restore']);
  }
});

test('choosing a saved edition restores its range at the canonical point and reveals it', async () => {
  const source = transpiler.transformSync(
    functionSource('restoreEPUBPlace') + functionSource('restoreCanonical'),
  );
  const { savedSelection, withResumeSelection } = await import('./resume-selection');
  const media = { id: 'epub', sha256: 'hash', representation: { id: 'edition' } };
  const canonical = { ...position('paragraph'), resolvable: true };
  const range = { href: 'chapter.xhtml', text: 'The full saved passage', before: '', after: '' };
  const edition = {
    epub_locator: { resume_selection: savedSelection(range, media as never, canonical) },
  };
  const events: string[] = [];
  const context = {
    alignmentID: 'alignment',
    mode: 'read',
    selectedEPUB: media,
    withResumeSelection,
    api: {
      canonicalToEPUB: async () => ({ href: range.href, offset: 0 }),
      representationState: async () => {
        throw new Error('Must use the chosen edition');
      },
    },
    reader: {
      current: {
        restoreLocation: async (target: { resume_selection: { range: unknown } }) => {
          expect(target.resume_selection.range).toEqual(range);
          events.push('restore');
          return true;
        },
        revealRestoredPlace: () => events.push('highlight'),
      },
    },
  };
  const restore = new Function(...Object.keys(context), `${source}; return restoreCanonical;`)(
    ...Object.values(context),
  );
  await restore(canonical, edition);
  expect(events).toEqual(['restore', 'highlight']);
});

test('late native page notifications do not erase a restored selection on the same visible page', async () => {
  const native = readFileSync(
    new URL('../../components/consumption/reader/EPUBReader.native.tsx', import.meta.url),
    'utf8',
  );
  const source = transpiler.transformSync(functionSource('handleLocation', native));
  const selected = { href: 'chapter.xhtml', locations: { progression: 0 } };
  const events: string[] = [];
  const context = {
    pendingNavigation: { current: undefined },
    Platform: { OS: 'ios' },
    selectedPage: { current: selected },
    direction: { current: undefined as string | undefined },
    selectedTextLocation: { current: 'saved-range' },
    clearFeedback: () => events.push('clear-feedback'),
    clearHighlight: () => events.push('clear-highlight'),
    currentPage: { current: selected },
    restoring: { current: false },
    locationRequest: { current: 0 },
    segmentsRef: { current: [] },
    pendingRestore: { current: undefined },
    readiumRestoreDisposition: () => 'publish',
    reader: { current: { currentVisibleLocation: async () => selected } },
    savedEPUBCFI: () => ({ cfi: 'verified-visible-anchor' }),
    __DEV__: false,
    preferredReadiumLocator: (locator: unknown) => locator,
    mapReadiumLocator: () => undefined,
    lastProgression: { current: 0 },
    readiumLocationReason: () => ({ reason: 'forward', pendingDirection: undefined }),
    onLocation: () => events.push('publish'),
  };
  const onLocation = new Function(...Object.keys(context), `${source}; return handleLocation;`)(
    ...Object.values(context),
  );
  // Readium fills in progression after the verified visible locator was captured.
  await onLocation({ ...selected, locations: { progression: 0.2 } });
  expect(events).toEqual([]);
  expect(context.selectedTextLocation.current).toBe('saved-range');
  expect(context.selectedPage.current).toBe(selected);
  context.direction.current = 'forward';
  await onLocation({ ...selected, locations: { progression: 0.3 } });
  expect(events).toEqual(['clear-feedback', 'clear-highlight', 'publish']);
  expect(context.selectedPage.current).toBeUndefined();
});
