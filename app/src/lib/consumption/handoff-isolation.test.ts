import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const sourceRoot = join(import.meta.dir, '..', '..');

/** Files allowed to import the handoff fixtures: tests, the fixtures themselves, and the dev-only preview. */
function mayImportFixtures(path: string) {
  return (
    path.includes('__fixtures__') ||
    path.endsWith('.test.ts') ||
    path.endsWith('.test.tsx') ||
    path === join('app', '(app)', 'dev-handoff.tsx')
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('handoff fixtures', () => {
  it('are imported only by tests and the development preview', () => {
    const offenders = sourceFiles(sourceRoot)
      .map((path) => relative(sourceRoot, path))
      .filter((path) => !mayImportFixtures(path))
      .filter((path) => readFileSync(join(sourceRoot, path), 'utf8').includes('handoff-fixtures'));

    expect(offenders).toEqual([]);
  });

  it('keep the preview route from rendering sample data outside development', () => {
    const route = readFileSync(join(sourceRoot, 'app', '(app)', 'dev-handoff.tsx'), 'utf8');

    expect(route).toContain('if (!__DEV__) return <Redirect');
  });
});
