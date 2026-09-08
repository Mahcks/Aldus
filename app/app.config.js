// Keep release metadata in app.json; only development installs need a separate identity.
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') return config;

  return {
    ...config,
    name: 'Aldus Dev',
    scheme: 'aldus-dev',
    ios: { ...config.ios, bundleIdentifier: 'com.mahcks.aldus.dev' },
    android: { ...config.android, package: 'com.mahcks.aldus.dev' },
    plugins: config.plugins.map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-dev-client') {
        // Use aldus-dev rather than sharing exp+aldus with the release app.
        return [plugin[0], { ...plugin[1], addGeneratedScheme: false }];
      }
      return plugin;
    }),
  };
};
