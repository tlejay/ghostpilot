import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'test-results/report', open: 'never' }]],
  use: {
    // Screenshots on failure land in test-results/
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Each test file gets its own electron process — no shared state between suites.
  workers: 1,
  projects: [
    {
      name: 'electron',
      use: {
        // electron executable is resolved at test runtime via _electron.launch()
        // so no browserName is set here.
      },
    },
  ],
});
