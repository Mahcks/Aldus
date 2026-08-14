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
    expect(patched).toContain("require_relative '../plugins/readium_post_install'");
    expect(patched).not.toContain("react-native-readium/scripts/readium_post_install'");
    expect(patched).toContain('  readium_pods');
    expect(patched).toContain('    aldus_readium_post_install(installer)');
    expect(patchPodfile(patched)).toBe(patched);
  });

  test('migrates the broken RC 17 upstream post-install hook', () => {
    const old = patchPodfile(podfile).replace(
      "require_relative '../plugins/readium_post_install'",
      "require_relative '../node_modules/react-native-readium/scripts/readium_post_install'",
    );
    expect(patchPodfile(old)).toContain("require_relative '../plugins/readium_post_install'");
    expect(patchPodfile(old)).toContain('    aldus_readium_post_install(installer)');
  });
});
