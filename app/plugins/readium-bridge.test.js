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
