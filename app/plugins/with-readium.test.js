const { describe, expect, test } = require('bun:test');
const { patchPodfile } = require('./with-readium');

const podfile = `require 'react-native/scripts/react_native_pods'

target 'Aldus' do
  use_expo_modules!

  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

describe('Readium config plugin', () => {
  test('adds the required sources, pods, and post-install hook once', () => {
    const patched = patchPodfile(podfile);
    expect(patched).toContain("source 'https://github.com/readium/podspecs'");
    expect(patched).toContain('  readium_pods');
    expect(patched).toContain('    readium_post_install(installer)');
    expect(patchPodfile(patched)).toBe(patched);
  });
});
