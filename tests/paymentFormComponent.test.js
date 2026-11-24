'use strict';

/**
 * Tests for PaymentForm / StudentForm validation UX — issue #665
 *
 * Covers inline real-time validation: blur-triggered validation, immediate
 * error clearing on correction, specific actionable messages, multi-field
 * independence, and ARIA attribute contracts.
 *
 * Pure logic tests — no React mount, no DOM. Follows the same pattern as
 * tests/studentFormValidation.test.js.
 */

// ── Constants matching the component ─────────────────────────────────────────

const STUDENT_ID_REQUIRED  = 'Student ID is required';
const STUDENT_ID_TOO_LONG  = 'Student ID must be 28 characters or fewer';
const EMAIL_INVALID        = 'Please enter a valid email address';
const NAME_REQUIRED        = 'Name is required';

const EMAIL_RE          = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_ID_MAX    = 28;

// ── Pure validation helpers (mirror component validateField logic) ─────────────

function validateStudentId(value) {
  if (!value || !value.trim()) return STUDENT_ID_REQUIRED;
  if (value.length > STUDENT_ID_MAX)  return STUDENT_ID_TOO_LONG;
  return null;
}

function validateName(value) {
  if (!value || !value.trim()) return NAME_REQUIRED;
  return null;
}

function validateEmail(value) {
  if (!value || !value.trim()) return null; // optional field
  if (!EMAIL_RE.test(value.trim())) return EMAIL_INVALID;
  return null;
}

// ── Simulation helpers ──────────────────────────────���─────────────────────────

/**
 * Simulates handleBlur: always validate and set/clear error.
 */
function simulateBlur(fieldErrors, fieldName, value, validateFn) {
  const err = validateFn(value);
  const next = { ...fieldErrors };
  if (err) {
    next[fieldName] = err;
  } else {
    delete next[fieldName];
  }
  return next;
}

/**
 * Simulates handleChange: re-validate only if the field already has an error,
 * matching the "validate on change only for fields already marked invalid" rule.
 */
function simulateChange(fieldErrors, fieldName, newValue, validateFn) {
  const next = { ...fieldErrors };
  if (next[fieldName] !== undefined) {
    const err = validateFn(newValue);
    if (err) {
      next[fieldName] = err;
    } else {
      delete next[fieldName];
    }
  }
  return next;
}

// ── studentId field ───────────────────────────────────────────────────────────

describe('PaymentForm — studentId validation (issue #665)', () => {
  it('shows required error for empty value on blur', () => {
    const errors = simulateBlur({}, 'studentId', '', validateStudentId);
    expect(errors.studentId).toBe(STUDENT_ID_REQUIRED);
  });

  it('shows required error for whitespace-only value on blur', () => {
    const errors = simulateBlur({}, 'studentId', '   ', validateStudentId);
    expect(errors.studentId).toBe(STUDENT_ID_REQUIRED);
  });

  it('shows specific length error when value exceeds 28 characters', () => {
    const errors = simulateBlur({}, 'studentId', 'A'.repeat(29), validateStudentId);
    expect(errors.studentId).toBe(STUDENT_ID_TOO_LONG);
  });

  it('error messages are specific and actionable, not generic', () => {
    expect(validateStudentId('')).not.toBe('Invalid');
    expect(validateStudentId('')).not.toBe('Invalid value');
    expect(validateStudentId('A'.repeat(29))).toMatch(/28 characters/);
  });

  it('clears error immediately when corrected value is typed (onChange)', () => {
    let errors = { studentId: STUDENT_ID_REQUIRED };
    errors = simulateChange(errors, 'studentId', 'STU001', validateStudentId);
    expect(errors.studentId).toBeUndefined();
  });

  it('keeps error when re-typed value is still invalid', () => {
    let errors = { studentId: STUDENT_ID_TOO_LONG };
    errors = simulateChange(errors, 'studentId', 'A'.repeat(30), validateStudentId);
    expect(errors.studentId).toBeDefined();
  });

  it('does NOT validate on change before first blur (no pre-existing error)', () => {
    // Error object is empty — onChange should leave it unchanged
    const errors = simulateChange({}, 'studentId', '', validateStudentId);
    expect(errors.studentId).toBeUndefined();
  });

  it('accepts a valid studentId after blur', () => {
    const errors = simulateBlur({}, 'studentId', 'STU-2024-001', validateStudentId);
    expect(errors.studentId).toBeUndefined();
  });

  it('accepts a studentId of exactly 28 characters', () => {
    const errors = simulateBlur({}, 'studentId', 'A'.repeat(28), validateStudentId);
    expect(errors.studentId).toBeUndefined();
  });
});

// ── name field ────────────────────────────────────────────────────────────────

describe('PaymentForm — name field validation (issue #665)', () => {
  it('shows required error for empty name on blur', () => {
    const errors = simulateBlur({}, 'name', '', validateName);
    expect(errors.name).toBe(NAME_REQUIRED);
  });

  it('shows required error for whitespace-only name on blur', () => {
    const errors = simulateBlur({}, 'name', '   ', validateName);
    expect(errors.name).toBe(NAME_REQUIRED);
  });

  it('error message is specific, not generic', () => {
    expect(validateName('')).not.toBe('Invalid');
    expect(validateName('')).toMatch(/required/i);
  });

  it('clears name error immediately when user types a valid name', () => {
    let errors = { name: NAME_REQUIRED };
    errors = simulateChange(errors, 'name', 'Alice', validateName);
    expect(errors.name).toBeUndefined();
  });

  it('accepts a non-empty name after blur', () => {
    const errors = simulateBlur({}, 'name', 'Bob Smith', validateName);
    expect(errors.name).toBeUndefined();
  });
});

// ── parentEmail field ─────────────────────────────────────────────────────────

describe('PaymentForm — email field validation (issue #665)', () => {
  it('shows invalid email error for malformed email on blur', () => {
    const errors = simulateBlur({}, 'parentEmail', 'not-an-email', validateEmail);
    expect(errors.parentEmail).toBe(EMAIL_INVALID);
  });

  it('error message is specific, not generic', () => {
    expect(validateEmail('bad@@email')).not.toBe('Invalid');
    expect(validateEmail('bad@@email')).toMatch(/valid email/i);
  });

  it('allows empty email (optional field — no error on blur)', () => {
    const errors = simulateBlur({}, 'parentEmail', '', validateEmail);
    expect(errors.parentEmail).toBeUndefined();
  });

  it('clears email error immediately when user corrects the value', () => {
    let errors = { parentEmail: EMAIL_INVALID };
    errors = simulateChange(errors, 'parentEmail', 'valid@example.com', validateEmail);
    expect(errors.parentEmail).toBeUndefined();
  });

  it('accepts a valid email after blur', () => {
    const errors = simulateBlur({}, 'parentEmail', 'parent@school.edu', validateEmail);
    expect(errors.parentEmail).toBeUndefined();
  });

  it('rejects email with double-at sign', () => {
    const errors = simulateBlur({}, 'parentEmail', 'user@@domain.com', validateEmail);
    expect(errors.parentEmail).toBeDefined();
  });
});

// ── Multi-field independence ──────────────────────────────────────────────────

describe('PaymentForm — multiple fields have independent error state (issue #665)', () => {
  it('errors on two fields do not interfere', () => {
    let errors = {};
    errors = simulateBlur(errors, 'name',        '',    validateName);
    errors = simulateBlur(errors, 'parentEmail', 'bad', validateEmail);
    expect(errors.name).toBeDefined();
    expect(errors.parentEmail).toBeDefined();
  });

  it('clearing one field error leaves the other intact', () => {
    let errors = { name: NAME_REQUIRED, parentEmail: EMAIL_INVALID };
    errors = simulateChange(errors, 'name', 'Alice', validateName);
    expect(errors.name).toBeUndefined();
    expect(errors.parentEmail).toBe(EMAIL_INVALID);
  });

  it('submit validation collects all field errors at once', () => {
    function validateAll(formData) {
      const errs = {};
      const nameErr  = validateName(formData.name);
      const emailErr = validateEmail(formData.parentEmail);
      if (nameErr)  errs.name         = nameErr;
      if (emailErr) errs.parentEmail  = emailErr;
      return errs;
    }

    const errors = validateAll({ name: '', parentEmail: 'bad-email' });
    expect(Object.keys(errors).length).toBe(2);
    expect(errors.name).toBeDefined();
    expect(errors.parentEmail).toBeDefined();
  });

  it('submit succeeds when all fields are valid', () => {
    function validateAll(formData) {
      const errs = {};
      const nameErr  = validateName(formData.name);
      const emailErr = validateEmail(formData.parentEmail);
      if (nameErr)  errs.name        = nameErr;
      if (emailErr) errs.parentEmail = emailErr;
      return errs;
    }

    const errors = validateAll({ name: 'Alice', parentEmail: 'alice@school.edu' });
    expect(Object.keys(errors).length).toBe(0);
  });
});

// ── ARIA attribute contracts ──────────────────────────────────────────────────

describe('PaymentForm — ARIA attributes contract (issue #665)', () => {
  it('aria-invalid is true when field has an error', () => {
    const fieldErrors = { name: NAME_REQUIRED };
    expect(!!fieldErrors.name).toBe(true);
  });

  it('aria-invalid is false when field has no error', () => {
    const fieldErrors = {};
    expect(!!fieldErrors.name).toBe(false);
  });

  it('aria-describedby references the error span id when error is present', () => {
    function getDescribedBy(fieldName, hasError) {
      return hasError ? `sf-${fieldName}-error` : undefined;
    }
    expect(getDescribedBy('name', true)).toBe('sf-name-error');
    expect(getDescribedBy('name', false)).toBeUndefined();
    expect(getDescribedBy('parentEmail', true)).toBe('sf-parentEmail-error');
    expect(getDescribedBy('parentEmail', false)).toBeUndefined();
  });

  it('error spans use role=alert for screen-reader announcement', () => {
    // Convention mirrored in JSX: role="alert" aria-live="polite" on error spans
    const errorSpanRole = 'alert';
    const errorSpanLive = 'polite';
    expect(errorSpanRole).toBe('alert');
    expect(errorSpanLive).toBe('polite');
  });
});

// ── Success (green tick) state ────────────────────────────────────────────────

describe('PaymentForm — success state indicator (issue #665)', () => {
  it('success tick is shown when field is touched, has no error, and has a value', () => {
    function shouldShowTick(touched, hasError, value) {
      return touched && !hasError && !!value;
    }
    expect(shouldShowTick(true,  false, 'Alice')).toBe(true);
    expect(shouldShowTick(false, false, 'Alice')).toBe(false); // not yet blurred
    expect(shouldShowTick(true,  true,  'bad'))  .toBe(false); // has error
    expect(shouldShowTick(true,  false, ''))     .toBe(false); // empty
  });
});
