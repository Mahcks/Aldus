const assert = require('node:assert/strict');
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
  if (!development) assert.deepEqual(result, expo);
}

delete process.env.APP_VARIANT;
assert.deepEqual(configure({ config: expo }), expo);
console.log('Development and release identities verified.');
