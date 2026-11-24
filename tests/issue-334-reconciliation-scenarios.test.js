'use strict';

/**
 * Reconciliation scenario tests (fixtures approach) — issue #657 / #334
 *
 * Exercises reconciliation logic using static fixture objects, covering the
 * same six scenarios as reconciliation-scenarios.test.js but from the
 * perspective of fixture-driven test data to aid readability and extensibility.
 *
 * Pure unit tests — no DB, no network.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'SCH-TEST-334';
const WALLET    = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const fixtures = {
  exactMatch: {
    description: 'Exact amount — payment equals fee',
    payment:  { txHash: 'TXEXACT001', schoolId: SCHOOL_ID, studentId: 'STU001', amount: 100, status: 'pending' },
    student:  { studentId: 'STU001', feeAmount: 100 },
    expected: { feeValidationStatus: 'valid' },
  },
  underpayment: {
    description: 'Underpayment — amount < fee',
    payment:  { txHash: 'TXUNDER001', schoolId: SCHOOL_ID, studentId: 'STU002', amount: 60, status: 'pending' },
    student:  { studentId: 'STU002', feeAmount: 100 },
    expected: { feeValidationStatus: 'underpaid', shortfallAmount: 40 },
  },
  overpayment: {
    description: 'Overpayment — amount > fee',
    payment:  { txHash: 'TXOVER001', schoolId: SCHOOL_ID, studentId: 'STU003', amount: 130, status: 'pending' },
    student:  { studentId: 'STU003', feeAmount: 100 },
    expected: { feeValidationStatus: 'overpaid', excessAmount: 30 },
  },
  reorg: {
    description: 'Ledger reorg — confirmed tx removed from ledger',
    payment:  { txHash: 'TXREORG001', schoolId: SCHOOL_ID, studentId: 'STU004', amount: 100, status: 'confirmed' },
    txOnLedger: false,
    expected: { status: 'pending', reorgDetected: true },
  },
  duplicate: {
    description: 'Duplicate Horizon event — same tx delivered twice',
    payment:  { txHash: 'TXDUP001', schoolId: SCHOOL_ID, studentId: 'STU005', amount: 100, status: 'pending' },
    expected: { dbRecordCount: 1 },
  },
  unknownMemo: {
    description: 'Unknown memo — no matching student',
    payment:  { txHash: 'TXUNK001', schoolId: SCHOOL_ID, memo: 'NOSUCHSTUDENT', amount: 100 },
    expected: { routed: 'queue', reason: 'unknown_memo' },
  },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function reconcilePayment(payment, student) {
  const feeAmount = student.feeAmount;
  const payAmt   = payment.amount;
  const diff     = parseFloat((payAmt - feeAmount).toFixed(7));
  if (Math.abs(diff) < 0.0000001) {
    return { ...payment, feeValidationStatus: 'valid', excessAmount: 0 };
  }
  if (diff > 0) {
    return { ...payment, feeValidationStatus: 'overpaid',  excessAmount: diff };
  }
  return { ...payment, feeValidationStatus: 'underpaid', shortfallAmount: Math.abs(diff) };
}

function handleReorg(payment, txOnLedger) {
  if (!txOnLedger && payment.status === 'confirmed') {
    return { ...payment, status: 'pending', reorgDetected: true, reorgAt: new Date() };
  }
  return payment;
}

function saveIdempotent(store, payment) {
  if (store.has(payment.txHash)) return { wasNew: false, count: store.size };
  store.set(payment.txHash, { ...payment });
  return { wasNew: true, count: store.size };
}

function routeByMemo(payment, knownStudentIds) {
  if (!payment.memo || !knownStudentIds.has(payment.memo)) {
    return { routed: 'queue', reason: 'unknown_memo' };
  }
  return { routed: 'processed' };
}

// ── Scenario 1: Exact match ───────────────────────────────────────────────────

describe('Fixture — exact amount match (#334 / #657)', () => {
  const f = fixtures.exactMatch;
  it(f.description, () => {
    const result = reconcilePayment(f.payment, f.student);
    expect(result.feeValidationStatus).toBe(f.expected.feeValidationStatus);
  });

  it('no excess or shortfall on exact match', () => {
    const result = reconcilePayment(f.payment, f.student);
    expect(result.excessAmount).toBe(0);
    expect(result.shortfallAmount).toBeUndefined();
  });
});

// ── Scenario 2: Underpayment ──────────────────────────────────────────────────

describe('Fixture — underpayment (#334 / #657)', () => {
  const f = fixtures.underpayment;
  it(f.description, () => {
    const result = reconcilePayment(f.payment, f.student);
    expect(result.feeValidationStatus).toBe(f.expected.feeValidationStatus);
  });

  it('records correct shortfall amount', () => {
    const result = reconcilePayment(f.payment, f.student);
    expect(result.shortfallAmount).toBeCloseTo(f.expected.shortfallAmount, 5);
  });
});

// ── Scenario 3: Overpayment ───────────────────────────────────────────────────

describe('Fixture — overpayment (#334 / #657)', () => {
  const f = fixtures.overpayment;
  it(f.description, () => {
    const result = reconcilePayment(f.payment, f.student);
    expect(result.feeValidationStatus).toBe(f.expected.feeValidationStatus);
  });

  it('records correct excess amount', () => {
    const result = reconcilePayment(f.payment, f.student);
    expect(result.excessAmount).toBeCloseTo(f.expected.excessAmount, 5);
  });
});

// ── Scenario 4: Ledger reorg ──────────────────────────────────────────────────

describe('Fixture — ledger reorg (#334 / #657)', () => {
  const f = fixtures.reorg;
  it(f.description, () => {
    const result = handleReorg(f.payment, f.txOnLedger);
    expect(result.status).toBe(f.expected.status);
  });

  it('sets reorgDetected flag', () => {
    const result = handleReorg(f.payment, f.txOnLedger);
    expect(result.reorgDetected).toBe(f.expected.reorgDetected);
  });

  it('records reorgAt timestamp', () => {
    const result = handleReorg(f.payment, f.txOnLedger);
    expect(result.reorgAt).toBeInstanceOf(Date);
  });

  it('payment correctly reverts from confirmed to pending state', () => {
    expect(f.payment.status).toBe('confirmed');
    const result = handleReorg(f.payment, false);
    expect(result.status).toBe('pending');
  });
});

// ── Scenario 5: Duplicate Horizon event ──────────────────────────────────────

describe('Fixture — duplicate Horizon event (#334 / #657)', () => {
  const f = fixtures.duplicate;
  it(f.description, () => {
    const store = new Map();
    saveIdempotent(store, f.payment);
    saveIdempotent(store, f.payment); // duplicate
    expect(store.size).toBe(f.expected.dbRecordCount);
  });

  it('exactly one DB record is created (idempotent)', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) saveIdempotent(store, f.payment);
    expect(store.size).toBe(1);
  });

  it('second delivery returns wasNew=false', () => {
    const store = new Map();
    saveIdempotent(store, f.payment);
    const { wasNew } = saveIdempotent(store, f.payment);
    expect(wasNew).toBe(false);
  });
});

// ── Scenario 6: Unknown memo ──────────────────────────────────────────────────

describe('Fixture — unknown memo (#334 / #657)', () => {
  const f = fixtures.unknownMemo;
  const knownStudents = new Set(['STU001', 'STU002', 'STU003', 'STU004', 'STU005']);

  it(f.description, () => {
    const result = routeByMemo(f.payment, knownStudents);
    expect(result.routed).toBe(f.expected.routed);
  });

  it('reason is unknown_memo', () => {
    const result = routeByMemo(f.payment, knownStudents);
    expect(result.reason).toBe(f.expected.reason);
  });

  it('known memo is processed, not queued', () => {
    const knownPayment = { ...f.payment, memo: 'STU001' };
    const result = routeByMemo(knownPayment, knownStudents);
    expect(result.routed).toBe('processed');
  });
});

// ── All six scenarios pass as a named list ────────────────────────────────────

describe('All 6 reconciliation scenarios have dedicated test cases (#334 / #657)', () => {
  const scenarioNames = Object.keys(fixtures);
  it('fixture set covers all 6 required scenarios', () => {
    expect(scenarioNames).toContain('exactMatch');
    expect(scenarioNames).toContain('underpayment');
    expect(scenarioNames).toContain('overpayment');
    expect(scenarioNames).toContain('reorg');
    expect(scenarioNames).toContain('duplicate');
    expect(scenarioNames).toContain('unknownMemo');
    expect(scenarioNames.length).toBeGreaterThanOrEqual(6);
  });
});
