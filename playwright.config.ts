import { defineConfig } from '@playwright/test';

const visualPort = Number(process.env.PLAYWRIGHT_PORT ?? '4173');

export default defineConfig({
  testDir: 'tests/visual',
  fullyParallel: false,
  workers: 1,
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: 0,
      scale: 'css',
      threshold: 0,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        baseURL: `http://127.0.0.1:${visualPort}`,
        browserName: 'chromium',
        deviceScaleFactor: 1,
        headless: true,
        viewport: { height: 1080, width: 1920 },
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @rivalhub-broadcast/web exec vite --host 127.0.0.1 --port ${visualPort}`,
    env: { VITE_VISUAL_FIXTURES: '1' },
    reuseExistingServer: !process.env.CI,
    url: `http://127.0.0.1:${visualPort}`,
  },
});
