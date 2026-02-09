import { defineConfig, devices } from '@playwright/test';

/**
 * Tanaghum Playwright Configuration
 * Smoke tests for the Arabic listening lesson generator
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  use: {
    // Use local server for testing
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    // Capture screenshots on failure
    screenshot: 'only-on-failure',

    // Capture trace on first retry
    trace: 'on-first-retry',

    // Video on failure
    video: 'retain-on-failure',

    // Viewport
    viewport: { width: 1280, height: 720 },
  },

  // Start local server before running tests
  webServer: {
    command: 'npx http-server . -p 3000 -c-1 --silent',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },

  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Output directory for test artifacts
  outputDir: 'test-results/',

  // Timeout settings
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
});
