import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Run the actual workflows with deferred I/O so ordering is deterministic.
function workflow(path: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function find(node: ts.Node): ts.FunctionDeclaration | undefined {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node;
    return ts.forEachChild(node, find);
  }
  const declaration = find(source);
  if (!declaration) throw new Error(`Missing workflow ${name}`);
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    declaration.getText(source).replace(/^export /, ''),
  );
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(
    ...Object.values(bindings),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('media lookup starts before slow settings finish, without skipping authoritative progress', async () => {
  const preferences = deferred<object>();
  const mediaStarted = deferred<void>();
  const progress = { revision: 7 };
  const load = workflow('./load-work.ts', 'loadConsumptionWork', {
    api: {
      work: async () => ({ library_id: 'library' }),
      representations: async () => [{ id: 'edition' }],
      alignmentJobs: async () => [],
      workProgress: async () => progress,
      workPreference: async () => null,
      readerPreferences: () => preferences.promise,
      media: async (library: string, edition: string) => {
        expect([library, edition]).toEqual(['library', 'edition']);
        mediaStarted.resolve();
        return [];
      },
    },
    Platform: { OS: 'web' },
    choices: () => [],
    defaultPair: () => ({}),
    pendingCanonicalProgress: (value: unknown) => value,
  });
  let finished = false;
  const result = load({ id: 'work' }).then((value: unknown) => {
    finished = true;
    return value;
  });
  await mediaStarted.promise;
  expect(finished).toBe(false);
  preferences.resolve({});
  expect((await result).effectiveProgress).toBe(progress);
});

test('native publication can prepare early, while canceled selections never publish', async () => {
  for (const canceled of [false, true]) {
    const source = deferred<string>();
    const published: string[] = [];
    const sourceID = { current: '' };
    const load = workflow('../../hooks/consumption/useConsumptionLoading.ts', 'loadEPUBSource', {
      loadEPUB: true,
      selectedEPUB: { id: 'media', size_bytes: 123 },
      epubSourceIDRef: sourceID,
      epubSource: undefined,
      productEPUBSource: () => source.promise,
      canceled,
      openedEPUB: false,
      Platform: { OS: 'ios' },
      setEPUBSource: (value: string) => published.push(value),
    });
    const result = load();
    expect(published).toEqual([]);
    source.resolve('file:///book.epub');
    expect(await result).toBe('file:///book.epub');
    expect(published).toEqual(canceled ? [] : ['file:///book.epub']);
    expect(sourceID.current).toBe(canceled ? '' : 'media');
  }
});

test('work detail overlaps independent lookups and media with a slow library response', async () => {
  const work = deferred<object>();
  const library = deferred<object>();
  const mediaStarted = deferred<void>();
  const calls: string[] = [];
  const progress = { revision: 7 };
  const load = workflow('../catalog/load-work-detail.ts', 'loadWorkDetail', {
    api: {
      work: () => work.promise,
      library: () => library.promise,
      representations: async () => {
        calls.push('representations');
        return [{ id: 'edition' }];
      },
      alignmentJobs: async () => {
        calls.push('jobs');
        return [];
      },
      workProgress: async () => {
        calls.push('progress');
        return progress;
      },
      workPreference: async () => {
        calls.push('preference');
        return null;
      },
      media: async (libraryID: string, editionID: string) => {
        expect([libraryID, editionID]).toEqual(['library', 'edition']);
        mediaStarted.resolve();
        return [{ id: 'media' }];
      },
    },
  });
  let finished = false;
  const result = load('work').then((value: unknown) => {
    finished = true;
    return value;
  });
  expect(calls).toEqual(['representations', 'jobs', 'progress', 'preference']);
  work.resolve({ library_id: 'library' });
  await mediaStarted.promise;
  expect(finished).toBe(false);
  library.resolve({ id: 'library' });
  const value = await result;
  expect(value.progress).toBe(progress);
  expect(value.revisions).toEqual([{ id: 'media', representation: { id: 'edition' } }]);
});
