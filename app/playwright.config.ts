import { defineConfig, devices } from '@playwright/test';

const externalServer = process.env.ALDUS_ECOSYSTEM_SERVER;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.ALDUS_ECOSYSTEM_WEB_URL || 'http://127.0.0.1:18081',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalServer
    ? undefined
    : [
        {
          command: '../scripts/web-e2e-server.sh',
          url: 'http://127.0.0.1:18080/api/ready',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command:
            'CI=1 EXPO_PUBLIC_WEB_API_URL=http://127.0.0.1:18080 bunx expo start --web --port 18081',
          url: 'http://127.0.0.1:18081',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
