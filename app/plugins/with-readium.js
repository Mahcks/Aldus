const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const sources = `source 'https://github.com/readium/podspecs'
source 'https://cdn.cocoapods.org/'`;
const helpers = `require_relative '../node_modules/react-native-readium/scripts/readium_pods'
require_relative '../node_modules/react-native-readium/scripts/readium_post_install'`;

function patchPodfile(contents) {
  let next = contents;
  if (!next.includes("source 'https://github.com/readium/podspecs'"))
    next = `${sources}\n\n${next}`;
  if (!next.includes('react-native-readium/scripts/readium_pods')) {
    const target = next.indexOf("target '");
    if (target < 0) throw new Error('Readium spike could not find the iOS Podfile target.');
    next = `${next.slice(0, target)}${helpers}\n\n${next.slice(target)}`;
  }
  if (!next.includes('\n  readium_pods\n')) {
    const useExpo = next.indexOf('  use_expo_modules!');
    if (useExpo < 0) throw new Error('Readium spike could not find use_expo_modules! in Podfile.');
    const lineEnd = next.indexOf('\n', useExpo);
    next = `${next.slice(0, lineEnd + 1)}  readium_pods\n${next.slice(lineEnd + 1)}`;
  }
  if (!next.includes('    readium_post_install(installer)')) {
    const postInstall = next.indexOf('  post_install do |installer|');
    const blockEnd = next.lastIndexOf('\n  end\nend');
    if (postInstall < 0 || blockEnd < postInstall) {
      throw new Error('Readium spike could not find the Podfile post_install block.');
    }
    next = `${next.slice(0, blockEnd)}\n    readium_post_install(installer)${next.slice(blockEnd)}`;
  }
  return next;
}

module.exports = (config) =>
  withDangerousMod(config, [
    'ios',
    async (mod) => {
      const podfile = path.join(mod.modRequest.platformProjectRoot, 'Podfile');
      fs.writeFileSync(podfile, patchPodfile(fs.readFileSync(podfile, 'utf8')));
      return mod;
    },
  ]);
module.exports.patchPodfile = patchPodfile;
