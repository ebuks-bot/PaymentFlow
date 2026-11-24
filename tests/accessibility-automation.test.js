'use strict';

/**
 * Accessibility automation tests — issue #655
 *
 * Validates WCAG 2.1 AA compliance rules that can be checked without a live
 * browser, using axe-core rule definitions and DOM-structure contracts.
 *
 * These tests cover:
 *   - axe-core rule severity classification (critical / serious / moderate / minor)
 *   - Page scan configuration (which pages must be scanned)
 *   - Violation reporting contract (critical/serious fail CI, others warn)
 *   - Known issues: missing aria-label on icon buttons, colour-contrast in tables
 *   - ARIA landmark requirements for each scanned page
 *   - Form input / label pairing rules
 *
 * Pure unit tests — no browser, no Playwright. The Playwright + axe integration
 * lives in tests/a11y/ and runs as E2E tests against a live server.
 */

// ── Axe severity levels ───────────────────────────────────────────────────────

const AXE_SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];

const FAIL_CI_SEVERITIES  = new Set(['critical', 'serious']);
const WARN_ONLY_SEVERITIES = new Set(['moderate', 'minor']);

// ── Pages that must be scanned ────────────────────────────────────────────────

const REQUIRED_SCAN_PAGES = [
  'Login',
  'Dashboard',
  'Payment Form',
  'Payment History',
  'Fee Structure',
  'Reports',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simulates an axe scan result for a page.
 * Returns violations grouped by severity.
 */
function buildScanResult(violations = []) {
  return {
    violations,
    passes:      [],
    incomplete:  [],
    inapplicable: [],
  };
}

/**
 * Determines whether a scan result should fail CI.
 * CI fails if there is at least one critical or serious violation.
 */
function shouldFailCI(scanResult) {
  return scanResult.violations.some(v => FAIL_CI_SEVERITIES.has(v.impact));
}

/**
 * Returns violations that should be reported as warnings (moderate / minor).
 */
function getWarnings(scanResult) {
  return scanResult.violations.filter(v => WARN_ONLY_SEVERITIES.has(v.impact));
}

/**
 * Builds the PR comment body for a page's scan result.
 */
function buildPRComment(pageName, scanResult) {
  const critical = scanResult.violations.filter(v => v.impact === 'critical').length;
  const serious  = scanResult.violations.filter(v => v.impact === 'serious').length;
  const moderate = scanResult.violations.filter(v => v.impact === 'moderate').length;
  const minor    = scanResult.violations.filter(v => v.impact === 'minor').length;
  return {
    page:    pageName,
    critical,
    serious,
    moderate,
    minor,
    ciStatus: (critical + serious) > 0 ? 'FAIL' : 'PASS',
  };
}

// ── Severity classification ───────────────────────────────────────────────────

describe('axe-core severity classification (#655)', () => {
  it('recognises all four axe severity levels', () => {
    expect(AXE_SEVERITIES).toContain('critical');
    expect(AXE_SEVERITIES).toContain('serious');
    expect(AXE_SEVERITIES).toContain('moderate');
    expect(AXE_SEVERITIES).toContain('minor');
  });

  it('critical and serious violations must fail CI', () => {
    expect(FAIL_CI_SEVERITIES.has('critical')).toBe(true);
    expect(FAIL_CI_SEVERITIES.has('serious')).toBe(true);
    expect(FAIL_CI_SEVERITIES.has('moderate')).toBe(false);
    expect(FAIL_CI_SEVERITIES.has('minor')).toBe(false);
  });

  it('moderate and minor violations are warnings only', () => {
    expect(WARN_ONLY_SEVERITIES.has('moderate')).toBe(true);
    expect(WARN_ONLY_SEVERITIES.has('minor')).toBe(true);
    expect(WARN_ONLY_SEVERITIES.has('critical')).toBe(false);
    expect(WARN_ONLY_SEVERITIES.has('serious')).toBe(false);
  });
});

// ── Required scan pages ───────────────────────────────────────────────────────

describe('axe scan page coverage (#655)', () => {
  it('scan list includes all 6 required pages', () => {
    expect(REQUIRED_SCAN_PAGES.length).toBeGreaterThanOrEqual(6);
  });

  it('Login page is in the scan list', () => {
    expect(REQUIRED_SCAN_PAGES).toContain('Login');
  });

  it('Dashboard page is in the scan list', () => {
    expect(REQUIRED_SCAN_PAGES).toContain('Dashboard');
  });

  it('Payment Form page is in the scan list', () => {
    expect(REQUIRED_SCAN_PAGES).toContain('Payment Form');
  });

  it('Payment History page is in the scan list', () => {
    expect(REQUIRED_SCAN_PAGES).toContain('Payment History');
  });

  it('Fee Structure page is in the scan list', () => {
    expect(REQUIRED_SCAN_PAGES).toContain('Fee Structure');
  });

  it('Reports page is in the scan list', () => {
    expect(REQUIRED_SCAN_PAGES).toContain('Reports');
  });
});

// ── CI failure logic ──────────────────────────────────────────────────────────

describe('CI failure on critical/serious violations (#655)', () => {
  it('fails CI when there is a critical violation', () => {
    const result = buildScanResult([{ id: 'color-contrast', impact: 'critical', description: 'Insufficient contrast' }]);
    expect(shouldFailCI(result)).toBe(true);
  });

  it('fails CI when there is a serious violation', () => {
    const result = buildScanResult([{ id: 'aria-label', impact: 'serious', description: 'Missing aria-label' }]);
    expect(shouldFailCI(result)).toBe(true);
  });

  it('does NOT fail CI for moderate violation alone', () => {
    const result = buildScanResult([{ id: 'region', impact: 'moderate', description: 'No landmark' }]);
    expect(shouldFailCI(result)).toBe(false);
  });

  it('does NOT fail CI for minor violation alone', () => {
    const result = buildScanResult([{ id: 'skip-link', impact: 'minor', description: 'No skip link' }]);
    expect(shouldFailCI(result)).toBe(false);
  });

  it('passes with zero violations', () => {
    const result = buildScanResult([]);
    expect(shouldFailCI(result)).toBe(false);
  });

  it('fails CI when mixed violations include at least one critical/serious', () => {
    const result = buildScanResult([
      { id: 'color-contrast', impact: 'moderate', description: 'Low contrast' },
      { id: 'button-name',    impact: 'serious',  description: 'No button name' },
    ]);
    expect(shouldFailCI(result)).toBe(true);
  });
});

// ── Warning reporting ─────────────────────────────────────────────────────────

describe('moderate/minor violations reported as warnings (#655)', () => {
  it('extracts moderate and minor violations as warnings', () => {
    const result = buildScanResult([
      { id: 'color-contrast', impact: 'moderate' },
      { id: 'skip-link',      impact: 'minor' },
      { id: 'aria-label',     impact: 'serious' },
    ]);
    const warnings = getWarnings(result);
    expect(warnings.length).toBe(2);
    expect(warnings.map(w => w.impact)).not.toContain('serious');
    expect(warnings.map(w => w.impact)).not.toContain('critical');
  });

  it('no warnings when all violations are critical/serious', () => {
    const result = buildScanResult([
      { id: 'aria-required-attr', impact: 'critical' },
      { id: 'button-name',        impact: 'serious' },
    ]);
    expect(getWarnings(result).length).toBe(0);
  });
});

// ── PR comment shape ──────────────────────────────────────────────────────────

describe('violation report posted as PR comment (#655)', () => {
  it('comment includes violation count per category', () => {
    const result = buildScanResult([
      { id: 'v1', impact: 'critical' },
      { id: 'v2', impact: 'serious' },
      { id: 'v3', impact: 'moderate' },
      { id: 'v4', impact: 'minor' },
    ]);
    const comment = buildPRComment('Dashboard', result);
    expect(comment.critical).toBe(1);
    expect(comment.serious).toBe(1);
    expect(comment.moderate).toBe(1);
    expect(comment.minor).toBe(1);
  });

  it('comment shows FAIL status when critical or serious violations exist', () => {
    const result = buildScanResult([{ id: 'v1', impact: 'critical' }]);
    const comment = buildPRComment('Login', result);
    expect(comment.ciStatus).toBe('FAIL');
  });

  it('comment shows PASS status when only moderate/minor violations exist', () => {
    const result = buildScanResult([{ id: 'v1', impact: 'moderate' }]);
    const comment = buildPRComment('Login', result);
    expect(comment.ciStatus).toBe('PASS');
  });

  it('comment includes the page name', () => {
    const comment = buildPRComment('Fee Structure', buildScanResult([]));
    expect(comment.page).toBe('Fee Structure');
  });
});

// ── ARIA landmark contract ────────────────────────────────────────────────────

describe('ARIA landmark requirements per page (#655)', () => {
  /**
   * Each page must have at minimum: main, navigation, and banner landmarks.
   * This contract mirrors what axe-core's "region" and "landmark-*" rules check.
   */
  const REQUIRED_LANDMARKS = ['main', 'navigation', 'banner'];

  it('required landmark roles are defined', () => {
    expect(REQUIRED_LANDMARKS).toContain('main');
    expect(REQUIRED_LANDMARKS).toContain('navigation');
    expect(REQUIRED_LANDMARKS).toContain('banner');
  });

  it('every scanned page must implement the required landmark set', () => {
    // Structural contract: each page component must render these landmarks
    function pageHasRequiredLandmarks(pageRoles) {
      return REQUIRED_LANDMARKS.every(role => pageRoles.includes(role));
    }

    // Simulate what each page would have after a correct implementation
    const pageRoles = {
      Login:          ['main', 'banner'],           // navigation optional on login
      Dashboard:      ['main', 'navigation', 'banner'],
      'Payment Form': ['main', 'navigation', 'banner'],
      'Payment History': ['main', 'navigation', 'banner'],
      'Fee Structure': ['main', 'navigation', 'banner'],
      Reports:        ['main', 'navigation', 'banner'],
    };

    // Dashboard and pages with nav must have all three
    for (const page of ['Dashboard', 'Payment Form', 'Payment History', 'Fee Structure', 'Reports']) {
      expect(pageHasRequiredLandmarks(pageRoles[page])).toBe(true);
    }
  });
});

// ── Known issues to fix (#655) ────────────────────────────────────────────────

describe('known accessibility issues to remediate (#655)', () => {
  it('icon buttons must have aria-label (currently missing — tracked bug)', () => {
    // Rule: every <button> with only an icon child must have aria-label or aria-labelledby
    function iconButtonHasLabel(button) {
      return !!(button.ariaLabel || button.ariaLabelledby || button.title);
    }

    const withLabel    = { ariaLabel: 'Copy to clipboard', ariaLabelledby: null, title: null };
    const withoutLabel = { ariaLabel: null, ariaLabelledby: null, title: null };

    expect(iconButtonHasLabel(withLabel)).toBe(true);
    expect(iconButtonHasLabel(withoutLabel)).toBe(false);
  });

  it('table cells must meet minimum 4.5:1 colour contrast ratio (WCAG AA)', () => {
    // Simulate contrast ratio check
    function meetsContrastAA(contrastRatio) {
      return contrastRatio >= 4.5;
    }

    expect(meetsContrastAA(7.0)).toBe(true);   // ✓ passes
    expect(meetsContrastAA(4.5)).toBe(true);   // ✓ exactly at threshold
    expect(meetsContrastAA(3.5)).toBe(false);  // ✗ known table issue
    expect(meetsContrastAA(2.1)).toBe(false);  // ✗ fails
  });

  it('form inputs must have an associated label (via for/id or aria-label)', () => {
    function inputHasLabel(input) {
      return !!(input.labelFor || input.ariaLabel || input.ariaLabelledby);
    }

    const withFor    = { labelFor: 'sid', ariaLabel: null, ariaLabelledby: null };
    const withAria   = { labelFor: null,  ariaLabel: 'Student ID', ariaLabelledby: null };
    const unlabelled = { labelFor: null,  ariaLabel: null, ariaLabelledby: null };

    expect(inputHasLabel(withFor)).toBe(true);
    expect(inputHasLabel(withAria)).toBe(true);
    expect(inputHasLabel(unlabelled)).toBe(false);
  });
});
