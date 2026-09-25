const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const configure = require('../app/app.config.js');
const { expo } = require('../app/app.json');
const { build } = require('../app/eas.json');

for (const profile of ['development', 'production', 'internal-preview']) {
  process.env.APP_VARIANT = build[profile].env.APP_VARIANT;
  const result = configure({ config: structuredClone(expo) });
  const development = profile === 'development';

  assert.equal(result.name, development ? 'Aldus Dev' : 'Aldus');
  assert.equal(result.scheme, development ? 'aldus-dev' : 'aldus');
  assert.equal(result.ios.bundleIdentifier, development ? 'com.mahcks.aldus.dev' : expo.ios.bundleIdentifier);
  assert.equal(result.android.package, development ? 'com.mahcks.aldus.dev' : expo.android.package);
  assert.equal(result.extra.eas.projectId, expo.extra.eas.projectId);
  assert.equal(result.ios.infoPlist.UIViewControllerBasedStatusBarAppearance, true,
    'Native-stack status bar options require view-controller ownership.');
  if (!development) assert.deepEqual(result, expo);
}

delete process.env.APP_VARIANT;
assert.doesNotMatch(readFileSync(path.join(__dirname, '../app/src/app/_layout.tsx'), 'utf8'),
  /expo-status-bar/, 'Do not mix the global status-bar manager with native-stack ownership.');
assert.deepEqual(configure({ config: expo }), expo);
console.log('Development and release identities verified.');
