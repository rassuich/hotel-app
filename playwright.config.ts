import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a pre-installed Chromium when the environment provides one (e.g. CI images).
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH || (existsSync(preinstalled) ? preinstalled : undefined);
const PORT = 3100;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    // A fake camera lets the in-app QR scanner be exercised headlessly.
    launchOptions: { executablePath, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // Fresh build + fresh demo database for every run; the seed output holds the private QR links.
    command:
      'npm run build && mkdir -p .e2e && rm -f .e2e/e2e.sqlite* && node dist/server/cli.mjs reset-demo > .e2e/seed.txt && node dist/server/index.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: '.e2e/e2e.sqlite',
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      RATE_LIMIT_ACTIVATION_MAX: '1000',
      RATE_LIMIT_LOGIN_MAX: '1000',
      SILENT_LOGS: 'true',
    },
  },
});
