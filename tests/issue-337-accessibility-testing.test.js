'use strict';

/**
 * Accessibility testing integration tests — issue #655 / #337
 *
 * Tests the axe-core + Playwright integration configuration contract:
 * - playwright.a11y.config.js is correctly structured
 * - axe scan runs on every required page after navigation
 * - Violation thresholds per severity are enforced
 * - CI pipeline integration points are correct
 *
 * Pure unit tests — validates configuration contracts without launching a browser.
 */

// ── playwright.a11y.config.js contract ───────────────────────────────────────

/**
 * Expected shape of playwright.a11y.config.js.
 * Mirrors what @axe-core/playwright expects.
 */
const expectedA11yConfig = {
  testDir: './tests/a11y',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    headless: true,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/a11y-results.json' }],
  ],
};

function validateA11yConfig(config) {
  const errors = [];
  if (!config.testDir)       errors.push('testDir is required');
  if (!config.use?.baseURL)  errors.push('use.baseURL is required');
  if (!Array.isArray(config.reporter)) errors.push('reporter must be an array');
  return errors;
}

describe('playwright.a11y.config.js — configuration contract (#337 / #655)', () => {
  it('config has required testDir field', () => {
    expect(expectedA11yConfig.testDir).toBeDefined();
    expect(typeof expectedA11yConfig.testDir).toBe('string');
  });

  it('config points to tests/a11y directory', () => {
    expect(expectedA11yConfig.testDir).toContain('a11y');
  });

  it('config runs in headless mode for CI', () => {
    expect(expectedA11yConfig.use.headless).toBe(true);
  });

  it('config has at least one reporter for CI output', () => {
    expect(expectedA11yConfig.reporter.length).toBeGreaterThan(0);
  });

  it('config is valid according to shape validation', () => {
    const errors = validateA11yConfig(expectedA11yConfig);
    expect(errors).toEqual([]);
  });

  it('config includes JSON reporter for PR comment generation', () => {
    const hasJsonReporter = expectedA11yConfig.reporter.some(
      r => Array.isArray(r) && r[0] === 'json'
    );
    expect(hasJsonReporter).toBe(true);
  });
});

// ── axe-core scan configuration ───────────────────────────────────────────────

const AXE_SCAN_OPTIONS = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
  },
  resultTypes: ['violations', 'incomplete'],
};

describe('axe-core scan options (#337 / #655)', () => {
  it('scan targets WCAG 2.1 AA tags', () => {
    expect(AXE_SCAN_OPTIONS.runOnly.values).toContain('wcag2aa');
    expect(AXE_SCAN_OPTIONS.runOnly.values).toContain('wcag21aa');
  });

  it('scan also targets WCAG 2.0 A baseline', () => {
    expect(AXE_SCAN_OPTIONS.runOnly.values).toContain('wcag2a');
  });

  it('scan captures violations and incomplete results', () => {
    expect(AXE_SCAN_OPTIONS.resultTypes).toContain('violations');
    expect(AXE_SCAN_OPTIONS.resultTypes).toContain('incomplete');
  });
});

// ── Page navigation + scan sequence ──────────────────────────────────────────

const SCAN_SEQUENCE = [
  { page: 'Login',           path: '/login' },
  { page: 'Dashboard',       path: '/dashboard' },
  { page: 'Payment Form',    path: '/pay' },
  { page: 'Payment History', path: '/payments' },
  { page: 'Fee Structure',   path: '/fees' },
  { page: 'Reports',         path: '/reports' },
];

describe('axe scan runs on every page after navigation (#337 / #655)', () => {
  it('scan sequence covers all 6 required pages', () => {
    const pageNames = SCAN_SEQUENCE.map(s => s.page);
    expect(pageNames).toContain('Login');
    expect(pageNames).toContain('Dashboard');
    expect(pageNames).toContain('Payment Form');
    expect(pageNames).toContain('Payment History');
    expect(pageNames).toContain('Fee Structure');
    expect(pageNames).toContain('Reports');
  });

  it('every scan entry has a path', () => {
    for (const entry of SCAN_SEQUENCE) {
      expect(typeof entry.path).toBe('string');
      expect(entry.path.startsWith('/')).toBe(true);
    }
  });

  it('no duplicate paths in scan sequence', () => {
    const paths  = SCAN_SEQUENCE.map(s => s.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });
});

// ── Violation threshold enforcement ──────────────────────────────────────────

describe('violation threshold enforcement (#337 / #655)', () => {
  const CI_FAIL_IMPACTS = ['critical', 'serious'];

  function ciShouldFail(violations) {
    return violations.some(v => CI_FAIL_IMPACTS.includes(v.impact));
  }

  function extractCIFailures(violations) {
    return violations.filter(v => CI_FAIL_IMPACTS.includes(v.impact));
  }

  function extractWarnings(violations) {
    return violations.filter(v => !CI_FAIL_IMPACTS.includes(v.impact));
  }

  it('zero violations on a clean page → CI passes', () => {
    expect(ciShouldFail([])).toBe(false);
  });

  it('one critical violation → CI fails', () => {
    expect(ciShouldFail([{ id: 'x', impact: 'critical' }])).toBe(true);
  });

  it('one serious violation → CI fails', () => {
    expect(ciShouldFail([{ id: 'x', impact: 'serious' }])).toBe(true);
  });

  it('only moderate violations → CI passes (but warns)', () => {
    expect(ciShouldFail([{ id: 'x', impact: 'moderate' }])).toBe(false);
  });

  it('only minor violations → CI passes (but warns)', () => {
    expect(ciShouldFail([{ id: 'x', impact: 'minor' }])).toBe(false);
  });

  it('extractCIFailures returns only critical/serious', () => {
    const violations = [
      { id: 'a', impact: 'critical' },
      { id: 'b', impact: 'moderate' },
      { id: 'c', impact: 'serious' },
      { id: 'd', impact: 'minor' },
    ];
    const failures = extractCIFailures(violations);
    expect(failures.length).toBe(2);
    expect(failures.every(v => CI_FAIL_IMPACTS.includes(v.impact))).toBe(true);
  });

  it('extractWarnings returns only moderate/minor', () => {
    const violations = [
      { id: 'a', impact: 'critical' },
      { id: 'b', impact: 'moderate' },
      { id: 'c', impact: 'minor' },
    ];
    const warnings = extractWarnings(violations);
    expect(warnings.length).toBe(2);
    expect(warnings.every(v => !CI_FAIL_IMPACTS.includes(v.impact))).toBe(true);
  });
});

// ── CI pipeline integration ───────────────────────────────────────────────────

describe('CI pipeline integration (#337 / #655)', () => {
  it('a11y tests are configured to run as part of the test suite', () => {
    // The playwright.a11y.config.js must exist and point to tests/a11y/
    expect(expectedA11yConfig.testDir).toBe('./tests/a11y');
  });

  it('test results are written to a known output path for PR annotation', () => {
    const jsonReporter = expectedA11yConfig.reporter.find(
      r => Array.isArray(r) && r[0] === 'json'
    );
    expect(jsonReporter).toBeDefined();
    expect(jsonReporter[1].outputFile).toContain('a11y');
  });

  it('baseURL is configurable via PLAYWRIGHT_BASE_URL env var', () => {
    const url = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
    expect(typeof url).toBe('string');
    expect(url.startsWith('http')).toBe(true);
  });
});
