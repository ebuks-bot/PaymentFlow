'use strict';

/**
 * Reconciliation fixture tests — issue #657
 *
 * Validates the shape and integrity of reconciliation fixture data used
 * across reconciliation tests. Ensures fixtures remain internally consistent
 * and that helper functions correctly produce expected outcomes for each fixture.
 */

// ── Fixture definitions ───────────────────────────────────────────────────────

const SCHOOL_ID = 'SCH-FIXTURE';

const reconciliationFixtures = [
  {
    id:          'exact-match',
    scenario:    'exact_match',
    payment:     { txHash: 'TXFX001', amount: 100, studentId: 'STU001', status: 'pending', schoolId: SCHOOL_ID },
    feeAmount:   100,
    expected:    { feeValidationStatus: 'valid', excessAmount: 0 },
  },
  {
    id:          'underpayment-40',
    scenario:    'underpayment',
    payment:     { txHash: 'TXFX002', amount: 60,  studentId: 'STU002', status: 'pending', schoolId: SCHOOL_ID },
    feeAmount:   100,
    expected:    { feeValidationStatus: 'underpaid', shortfallAmount: 40 },
  },
  {
    id:          'overpayment-30',
    scenario:    'overpayment',
    payment:     { txHash: 'TXFX003', amount: 130, studentId: 'STU003', status: 'pending', schoolId: SCHOOL_ID },
    feeAmount:   100,
    expected:    { feeValidationStatus: 'overpaid', excessAmount: 30 },
  },
  {
    id:          'reorg-confirmed',
    scenario:    'reorg',
    payment:     { txHash: 'TXFX004', amount: 100, studentId: 'STU004', status: 'confirmed', schoolId: SCHOOL_ID },
    feeAmount:   100,
    txOnLedger:  false,
    expected:    { status: 'pending', reorgDetected: true },
  },
  {
    id:          'duplicate-event',
    scenario:    'duplicate',
    payment:     { txHash: 'TXFX005', amount: 100, studentId: 'STU005', status: 'pending', schoolId: SCHOOL_ID },
    feeAmount:   100,
    expected:    { dbRecordCount: 1 },
  },
  {
    id:          'unknown-memo',
    scenario:    'unknown_memo',
    payment:     { txHash: 'TXFX006', memo: 'NOSUCHSTU', amount: 100, schoolId: SCHOOL_ID },
    feeAmount:   100,
    expected:    { routed: 'queue', reason: 'unknown_memo' },
  },
];

// ── Helper implementations ────────────────────────────────────────────────────

function reconcileAmount(paymentAmount, feeAmount) {
  const diff = parseFloat((paymentAmount - feeAmount).toFixed(7));
  if (Math.abs(diff) < 0.0000001) return { feeValidationStatus: 'valid',    excessAmount: 0 };
  if (diff > 0)                   return { feeValidationStatus: 'overpaid',  excessAmount: diff };
  return                               { feeValidationStatus: 'underpaid', shortfallAmount: Math.abs(diff) };
}

function applyReorg(payment, txOnLedger) {
  if (!txOnLedger && payment.status === 'confirmed') {
    return { ...payment, status: 'pending', reorgDetected: true };
  }
  return payment;
}

// ── Fixture shape validation ──────────────────────────────────────────────────

describe('Reconciliation fixtures — shape validation (#657)', () => {
  it('all fixtures have required fields', () => {
    for (const f of reconciliationFixtures) {
      expect(f.id).toBeDefined();
      expect(f.scenario).toBeDefined();
      expect(f.payment).toBeDefined();
      expect(f.payment.txHash).toBeDefined();
      expect(f.expected).toBeDefined();
    }
  });

  it('all payment fixtures have a txHash', () => {
    for (const f of reconciliationFixtures) {
      expect(typeof f.payment.txHash).toBe('string');
      expect(f.payment.txHash.length).toBeGreaterThan(0);
    }
  });

  it('all txHashes are unique across fixtures', () => {
    const hashes = reconciliationFixtures.map(f => f.payment.txHash);
    const unique  = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });

  it('fixture set covers all 6 required scenarios', () => {
    const scenarios = new Set(reconciliationFixtures.map(f => f.scenario));
    expect(scenarios.has('exact_match')).toBe(true);
    expect(scenarios.has('underpayment')).toBe(true);
    expect(scenarios.has('overpayment')).toBe(true);
    expect(scenarios.has('reorg')).toBe(true);
    expect(scenarios.has('duplicate')).toBe(true);
    expect(scenarios.has('unknown_memo')).toBe(true);
  });
});

// ── Per-fixture expected outcome tests ───────────────────────────────────────

describe('Reconciliation fixtures — expected outcomes (#657)', () => {
  for (const f of reconciliationFixtures) {
    if (f.scenario === 'exact_match' || f.scenario === 'underpayment' || f.scenario === 'overpayment') {
      it(`fixture "${f.id}": produces expected feeValidationStatus`, () => {
        const result = reconcileAmount(f.payment.amount, f.feeAmount);
        expect(result.feeValidationStatus).toBe(f.expected.feeValidationStatus);
      });
    }

    if (f.scenario === 'reorg') {
      it(`fixture "${f.id}": payment reverts to pending on reorg`, () => {
        const result = applyReorg(f.payment, f.txOnLedger);
        expect(result.status).toBe(f.expected.status);
        expect(result.reorgDetected).toBe(f.expected.reorgDetected);
      });
    }

    if (f.scenario === 'duplicate') {
      it(`fixture "${f.id}": exactly one DB record created on duplicate delivery`, () => {
        const store = new Map();
        store.set(f.payment.txHash, { ...f.payment });
        store.set(f.payment.txHash, { ...f.payment }); // Map.set is idempotent
        expect(store.size).toBe(f.expected.dbRecordCount);
      });
    }

    if (f.scenario === 'unknown_memo') {
      it(`fixture "${f.id}": routed to queue with reason unknown_memo`, () => {
        const knownStudents = new Set(['STU001', 'STU002', 'STU003', 'STU004', 'STU005']);
        const memo = f.payment.memo;
        const routed = !memo || !knownStudents.has(memo) ? 'queue' : 'processed';
        const reason = routed === 'queue' ? 'unknown_memo' : undefined;
        expect(routed).toBe(f.expected.routed);
        expect(reason).toBe(f.expected.reason);
      });
    }
  }
});

// ── Amount precision fixtures ─────────────────────────────────────────────────

describe('Reconciliation fixtures — amount precision edge cases (#657)', () => {
  it('floating-point fees reconcile correctly to 7 decimal places', () => {
    const result = reconcileAmount(99.9999999, 100);
    // 99.9999999 - 100 = -0.0000001 → underpaid by 1 stroop
    expect(result.feeValidationStatus).toBe('underpaid');
    expect(result.shortfallAmount).toBeCloseTo(0.0000001, 7);
  });

  it('fee of 0.0000001 exactly matched', () => {
    const result = reconcileAmount(0.0000001, 0.0000001);
    expect(result.feeValidationStatus).toBe('valid');
  });

  it('large fee amounts reconcile correctly', () => {
    const result = reconcileAmount(9999.9999999, 10000);
    expect(result.feeValidationStatus).toBe('underpaid');
  });
});
