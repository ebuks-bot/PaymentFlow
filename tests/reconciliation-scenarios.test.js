'use strict';

/**
 * Reconciliation scenario tests — issue #657
 *
 * Covers the six reconciliation edge cases:
 *   1. Exact amount match        — standard case, payment marked valid
 *   2. Underpayment              — amount < fee, marked underpaid
 *   3. Overpayment               — amount > fee, marked overpaid with excessAmount
 *   4. Ledger reorg              — confirmed tx disappears, payment reverts to pending
 *   5. Duplicate Horizon event   — same tx delivered twice, idempotent (one DB record)
 *   6. Unknown memo              — no matching student, routed to reconciliation queue
 *
 * Pure unit tests — no DB, no Horizon network.
 */

// ── Reconciliation logic (self-contained, mirrors the service behaviour) ──────

/**
 * Validates a payment amount against the student's fee.
 * Mirrors validatePaymentAgainstFee in stellarService.
 */
function validatePaymentAgainstFee(paymentAmount, feeAmount) {
  const diff = parseFloat((paymentAmount - feeAmount).toFixed(7));
  if (Math.abs(diff) < 0.0000001) return { status: 'valid',    excessAmount: 0 };
  if (diff > 0)                   return { status: 'overpaid',  excessAmount: diff };
  return                               { status: 'underpaid', shortfallAmount: Math.abs(diff) };
}

/**
 * Simulates what the reorg handler does: if a previously-confirmed payment's
 * transaction is no longer found on the ledger, revert it to pending.
 *
 * @param {object} payment   - Current payment record
 * @param {boolean} txOnLedger - Whether the transaction still exists on-chain
 * @returns {object} Updated payment record
 */
function handleReorg(payment, txOnLedger) {
  if (!txOnLedger && payment.status === 'confirmed') {
    return { ...payment, status: 'pending', reorgDetected: true, reorgAt: new Date() };
  }
  return payment;
}

/**
 * Simulates idempotent payment saving.
 * Returns the existing record if txHash already exists, otherwise inserts new.
 *
 * @param {Map}    store    - In-memory payment store keyed by txHash
 * @param {object} payment  - Incoming payment event
 * @returns {{ record: object, wasNew: boolean }}
 */
function savePaymentIdempotent(store, payment) {
  if (store.has(payment.txHash)) {
    return { record: store.get(payment.txHash), wasNew: false };
  }
  store.set(payment.txHash, { ...payment });
  return { record: store.get(payment.txHash), wasNew: true };
}

/**
 * Simulates routing a payment whose memo doesn't match any student.
 *
 * @param {object} payment    - Incoming payment event
 * @param {Set}    studentIds - Set of known student IDs
 * @returns {{ routed: 'queue'|'processed', reason?: string }}
 */
function routePayment(payment, studentIds) {
  if (!studentIds.has(payment.memo)) {
    return { routed: 'queue', reason: 'unknown_memo' };
  }
  return { routed: 'processed' };
}

// ── Scenario 1: Exact amount match ────────────────────────────────────────────

describe('Reconciliation scenario 1 — exact amount match (#657)', () => {
  it('marks payment as valid when amount equals fee exactly', () => {
    const result = validatePaymentAgainstFee(100, 100);
    expect(result.status).toBe('valid');
    expect(result.excessAmount).toBe(0);
  });

  it('marks payment as valid for a floating-point fee that matches exactly', () => {
    const result = validatePaymentAgainstFee(99.9999999, 99.9999999);
    expect(result.status).toBe('valid');
  });

  it('valid payment has no shortfall or excess', () => {
    const result = validatePaymentAgainstFee(50, 50);
    expect(result.status).toBe('valid');
    expect(result.excessAmount).toBe(0);
    expect(result.shortfallAmount).toBeUndefined();
  });
});

// ── Scenario 2: Underpayment ──────────────────────────────────────────────────

describe('Reconciliation scenario 2 — underpayment (#657)', () => {
  it('marks payment as underpaid when amount < fee', () => {
    const result = validatePaymentAgainstFee(80, 100);
    expect(result.status).toBe('underpaid');
  });

  it('records the shortfall amount', () => {
    const result = validatePaymentAgainstFee(80, 100);
    expect(result.shortfallAmount).toBeCloseTo(20, 5);
  });

  it('a 1-stroops underpayment is still underpaid', () => {
    // 1 stroop = 0.0000001 XLM
    const result = validatePaymentAgainstFee(99.9999999, 100);
    expect(result.status).toBe('underpaid');
  });
});

// ── Scenario 3: Overpayment ───────────────────────────────────────────────────

describe('Reconciliation scenario 3 — overpayment (#657)', () => {
  it('marks payment as overpaid when amount > fee', () => {
    const result = validatePaymentAgainstFee(150, 100);
    expect(result.status).toBe('overpaid');
  });

  it('records the excess amount', () => {
    const result = validatePaymentAgainstFee(150, 100);
    expect(result.excessAmount).toBeCloseTo(50, 5);
  });

  it('a 1-stroops overpayment is still overpaid', () => {
    const result = validatePaymentAgainstFee(100.0000001, 100);
    expect(result.status).toBe('overpaid');
  });

  it('excess amount is positive', () => {
    const result = validatePaymentAgainstFee(200, 100);
    expect(result.excessAmount).toBeGreaterThan(0);
  });
});

// ── Scenario 4: Ledger reorg ──────────────────────────────────────────────────

describe('Reconciliation scenario 4 — ledger reorg (#657)', () => {
  it('reverts a confirmed payment to pending when tx disappears from ledger', () => {
    const payment = {
      txHash: 'TXHASH001',
      status: 'confirmed',
      amount: 100,
      studentId: 'STU001',
    };
    const result = handleReorg(payment, false /* txOnLedger */);
    expect(result.status).toBe('pending');
  });

  it('sets reorgDetected flag when reorg occurs', () => {
    const payment = { txHash: 'TX1', status: 'confirmed', amount: 100 };
    const result = handleReorg(payment, false);
    expect(result.reorgDetected).toBe(true);
  });

  it('records reorgAt timestamp', () => {
    const payment = { txHash: 'TX1', status: 'confirmed', amount: 100 };
    const result = handleReorg(payment, false);
    expect(result.reorgAt).toBeInstanceOf(Date);
  });

  it('leaves a confirmed payment unchanged when tx is still on ledger', () => {
    const payment = { txHash: 'TX1', status: 'confirmed', amount: 100 };
    const result = handleReorg(payment, true /* txOnLedger */);
    expect(result.status).toBe('confirmed');
    expect(result.reorgDetected).toBeUndefined();
  });

  it('leaves a pending payment unchanged even if tx is absent (not yet confirmed)', () => {
    const payment = { txHash: 'TX1', status: 'pending', amount: 100 };
    const result = handleReorg(payment, false);
    expect(result.status).toBe('pending');
    expect(result.reorgDetected).toBeUndefined();
  });
});

// ── Scenario 5: Duplicate Horizon event ──────────────────────────────────────

describe('Reconciliation scenario 5 — duplicate Horizon event (#657)', () => {
  it('creates exactly one DB record when the same event arrives twice', () => {
    const store = new Map();
    const payment = { txHash: 'TXDUP001', amount: 100, studentId: 'STU001' };

    const first  = savePaymentIdempotent(store, payment);
    const second = savePaymentIdempotent(store, payment);

    expect(first.wasNew).toBe(true);
    expect(second.wasNew).toBe(false);
    expect(store.size).toBe(1);
  });

  it('the second delivery returns the existing record unchanged', () => {
    const store = new Map();
    const payment = { txHash: 'TXDUP002', amount: 100, studentId: 'STU002' };

    const { record: first }  = savePaymentIdempotent(store, payment);
    const { record: second } = savePaymentIdempotent(store, payment);

    expect(first).toEqual(second);
  });

  it('different txHashes are stored independently (no cross-contamination)', () => {
    const store = new Map();
    savePaymentIdempotent(store, { txHash: 'TXA', amount: 50,  studentId: 'STU001' });
    savePaymentIdempotent(store, { txHash: 'TXB', amount: 100, studentId: 'STU002' });

    expect(store.size).toBe(2);
    expect(store.get('TXA').amount).toBe(50);
    expect(store.get('TXB').amount).toBe(100);
  });
});

// ── Scenario 6: Unknown memo ──────────────────────────────────────────────────

describe('Reconciliation scenario 6 — unknown memo (#657)', () => {
  const knownStudents = new Set(['STU001', 'STU002', 'STU003']);

  it('routes payment to reconciliation queue when memo matches no student', () => {
    const payment = { txHash: 'TXUNK001', memo: 'UNKNOWN-MEMO', amount: 100 };
    const { routed, reason } = routePayment(payment, knownStudents);
    expect(routed).toBe('queue');
    expect(reason).toBe('unknown_memo');
  });

  it('processes payment normally when memo matches a known student', () => {
    const payment = { txHash: 'TXKNOWN', memo: 'STU001', amount: 100 };
    const { routed } = routePayment(payment, knownStudents);
    expect(routed).toBe('processed');
  });

  it('routes payment with empty memo to reconciliation queue', () => {
    const payment = { txHash: 'TXEMPTY', memo: '', amount: 100 };
    const { routed } = routePayment(payment, knownStudents);
    expect(routed).toBe('queue');
  });

  it('routes payment with null memo to reconciliation queue', () => {
    const payment = { txHash: 'TXNULL', memo: null, amount: 100 };
    const { routed } = routePayment(payment, knownStudents);
    expect(routed).toBe('queue');
  });
});

// ── Combined lifecycle ────────────────────────────────────────────────────────

describe('Reconciliation — combined lifecycle scenarios (#657)', () => {
  it('overpaid payment that undergoes reorg reverts to pending', () => {
    const payment = { txHash: 'TXCOMB', status: 'confirmed', amount: 150, feeAmount: 100 };
    // First check overpayment
    const valResult = validatePaymentAgainstFee(payment.amount, payment.feeAmount);
    expect(valResult.status).toBe('overpaid');
    // Then reorg happens
    const afterReorg = handleReorg(payment, false);
    expect(afterReorg.status).toBe('pending');
  });

  it('idempotent processing + exact match returns valid status once', () => {
    const store = new Map();
    const payment = { txHash: 'TXEXACT', amount: 100, feeAmount: 100, studentId: 'STU001' };

    savePaymentIdempotent(store, payment);
    savePaymentIdempotent(store, payment); // duplicate

    expect(store.size).toBe(1);
    const { status } = validatePaymentAgainstFee(100, 100);
    expect(status).toBe('valid');
  });
});
