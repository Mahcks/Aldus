const { test, expect } = require('bun:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

for (const file of ['src/components/ReadiumView.tsx', 'lib/src/components/ReadiumView.js']) {
  test(`${file}: restore bridge preserves native failures`, async () => {
    const source = readFileSync(
      join(__dirname, '../node_modules/react-native-readium', file),
      'utf8',
    );
    const method = source.match(
      /restoreTo:\s*(async \(locator\) => \{[\s\S]*?\}),\s*goForward:/,
    )?.[1];
    expect(method).toBeDefined();
    const failure = new Error('Aldus restore v2: visible-resource-mismatch');
    const hybridRef = {
      current: {
        restoreTo: async () => {
          throw failure;
        },
      },
    };
    const restore = new Function('hybridRef', `return (${method});`)(hybridRef);
    await expect(restore({ href: 'chapter.xhtml' })).rejects.toBe(failure);
    hybridRef.current.restoreTo = async () => false;
    expect(await restore({})).toBe(false);
    hybridRef.current.restoreTo = async () => true;
    expect(await restore({})).toBe(true);
    hybridRef.current = undefined;
    await expect(restore({})).rejects.toThrow('Native restore bridge is unavailable');
  });
}

test('native locator conversion uses the shared encoded-URL/decoded-path fallback', () => {
  const native = join(__dirname, '../node_modules/react-native-readium/ios');
  const normalizer = readFileSync(join(native, 'HrefNormalizer.swift'), 'utf8');
  const converter = readFileSync(join(native, 'DecorationData.swift'), 'utf8');
  const restore = readFileSync(join(native, 'HybridReadiumView.swift'), 'utf8');
  expect(normalizer).toContain(
    'AnyURL(string: normalized.resourcePath) ?? AnyURL(path: normalized.resourcePath)',
  );
  expect(converter).toContain('guard let anyURL = anyURLFromNitroHref(href)');
  expect(converter).not.toContain('AnyURL(string: normalized.resourcePath)');
  expect(restore).toContain('failure("reader-unavailable")');
  expect(restore).toContain('failure("target-locator-invalid")');
  expect(restore).toContain('failure("target-json-unavailable")');
  expect(restore).not.toContain('reader-or-target-unavailable');
});
