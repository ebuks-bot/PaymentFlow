// @ts-check
/**
 * Playwright configuration for axe-core accessibility automation — issue #655
 *
 * Runs @axe-core/playwright scans on every page after navigation.
 * CI fails on any critical or serious axe violation.
 * Moderate and minor violations are reported as warnings in the PR comment.
 *
 * Usage:
 *   npx playwright test --config=playwright.a11y.config.js
 *
 * Environment:
 *   PLAYWRIGHT_BASE_URL — override the target base URL (default: http://localhost:3000)
 */

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/a11y',

  /* Run all a11y tests serially to avoid port conflicts on CI */
  fullyParallel: false,
  workers: 1,

  /* Fail fast on CI if any critical/serious violation is found */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  /* Reporters: list for console, JSON for PR annotation, HTML for local review */
  reporter: [
    ['list'],
    ['json',  { outputFile: 'test-results/a11y-results.json' }],
    ['html',  { outputFolder: 'playwright-report/a11y', open: 'never' }],
  ],

  use: {
    /* Base URL — override with PLAYWRIGHT_BASE_URL in CI */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* Always headless in CI */
    headless: true,

    /* Capture traces on first retry to aid debugging */
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',

    /* axe-core options injected into every scan */
    axeOptions: {
      runOnly: {
        type:   'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
      },
      resultTypes: ['violations'],
    },
  },

  projects: [
    {
      name: 'chromium-a11y',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Allow the app server 30 s to start before running tests */
  webServer: process.env.CI
    ? undefined  // CI starts the server separately
    : {
        command: 'npm run dev',
        url:     'http://localhost:3000',
        timeout: 30_000,
        reuseExistingServer: true,
      },
});
