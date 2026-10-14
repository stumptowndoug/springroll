import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure', reducedMotion: 'reduce' },
  webServer: { command: 'node server.mjs', url: 'http://127.0.0.1:4178', reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1100, height: 760 } } },
    { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1100, height: 760 } } },
    { name: 'phone', use: { ...devices['iPhone SE'], browserName: 'webkit' } },
  ],
});
