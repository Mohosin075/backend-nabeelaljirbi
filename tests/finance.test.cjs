const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money, calculateBookingFees } = require('../src/utils/money');
const { settlementOperations } = require('../src/app/modules/Admin/settlement.operations');

test('Model A uses the configured fixed 75, not 7.5, and excludes cash consultation', () => {
  assert.deepEqual(calculateBookingFees({ consultFee: 75, collectionMode: 'MODE_A', fixedPatientFee: 75, patientPercentage: 10, clinicPercentage: 0 }), {
    consultFee: 75, collectionMode: 'MODE_A', serviceFeePercentage: 0, serviceFeeAmount: 75, clinicServiceFee: 0, holdAmount: 75,
  });
});
test('Model B separates patient and clinic percentages without truncating decimals', () => {
  const fees = calculateBookingFees({ consultFee: 75.5, collectionMode: 'MODE_B', patientPercentage: 10, clinicPercentage: 2 });
  assert.equal(fees.serviceFeeAmount, 7.55);
  assert.equal(fees.clinicServiceFee, 1.51);
  assert.equal(fees.holdAmount, 83.05);
});
test('half-cent amounts and percentage fees round exactly instead of rounding down in binary', () => {
  assert.equal(money(10.075), 10.08);
  assert.equal(money('1.005'), 1.01);
  const result = calculateBookingFees({ consultFee: 100.75, collectionMode: 'MODE_B', patientPercentage: 10, clinicPercentage: 10 });
  assert.equal(result.serviceFeeAmount, 10.08);
  assert.equal(result.clinicServiceFee, 10.08);
  assert.equal(result.holdAmount, 110.83);
});
test('missing fixed fee and invalid monetary input fail closed', () => {
  for (const value of [-1, NaN, Infinity, '', ' ', [], {}, null, undefined, true]) assert.throws(() => money(value));
  assert.throws(() => money(0.001, false));
  assert.throws(() => calculateBookingFees({ consultFee: 75, collectionMode: 'MODE_A', patientPercentage: 10, clinicPercentage: 0 }));
  assert.equal(money('75.50'), 75.5);
});

const admin = { id: 'admin', role: 'ADMIN', adminTier: 'FINANCE' };
function fixture() {
  let state = {
    owner: { id: 'owner', wallet: 100, frozenWallet: 0, status: 'ACTIVE', banned: false },
    settlement: { id: 's1', clinicId: 'c1', doctorId: null, amount: 75, status: 'APPROVED', clinic: { id: 'c1', userId: 'owner' }, receiptUrl: null, reference: null },
    journals: [], audits: [], reserved: 0,
  };
  // Transactional adapter tests rollback and service behavior; PostgreSQL isolation
  // still needs a staging integration check with a disposable database.
  const db = { $transaction: async (operation) => {
    const draft = structuredClone(state);
    const tx = {
      settlement: {
        findUnique: async () => draft.settlement,
        findUniqueOrThrow: async () => draft.settlement,
        aggregate: async () => ({ _sum: { amount: draft.reserved } }),
        updateMany: async ({ where, data }) => {
          if (where.status !== draft.settlement.status) return { count: 0 };
          Object.assign(draft.settlement, data); return { count: 1 };
        },
      },
      user: {
        findUnique: async () => draft.owner,
        updateMany: async ({ where, data }) => {
          if (draft.owner.wallet < where.wallet.gte) return { count: 0 };
          draft.owner.wallet -= data.wallet.decrement; return { count: 1 };
        },
      },
      topUp: { create: async ({ data }) => { draft.journals.push(data); } },
      adminAuditLog: { create: async ({ data }) => { draft.audits.push(data); } },
    };
    const result = await operation(tx);
    state = draft;
    return result;
  } };
  return { operations: settlementOperations(db), state: () => state,
    setFrozen: value => { state.owner.frozenWallet = value; }, setReserved: value => { state.reserved = value; },
    setAmount: value => { state.settlement.amount = value; },
    setWallet: (value) => { state.owner.wallet = value; }, setStatus: (value) => { state.settlement.status = value; }, failAudit: () => {
    const original = db.$transaction;
    db.$transaction = operation => original(tx => { tx.adminAuditLog.create = async () => { throw Error('audit unavailable'); }; return operation(tx); });
  } };
}
const paid = { status: 'COMPLETED', reference: 'BANK-1', receiptUrl: 'https://example.com/receipt.pdf' };
test('paid settlement is atomic, journaled and idempotent on repeated request', async () => {
  const f = fixture();
  await f.operations.update('s1', paid, admin);
  await f.operations.update('s1', paid, admin);
  assert.equal(f.state().owner.wallet, 25);
  assert.equal(f.state().journals.length, 1);
  assert.equal(f.state().journals[0].id, 'settlement:s1:debit');
  assert.equal(f.state().settlement.status, 'COMPLETED');
});
test('insufficient balance rolls back both status and journal', async () => {
  const f = fixture(); f.setWallet(50);
  await assert.rejects(f.operations.update('s1', paid, admin), /Insufficient/);
  assert.equal(f.state().owner.wallet, 50);
  assert.equal(f.state().settlement.status, 'APPROVED');
  assert.equal(f.state().journals.length, 0);
});
test('audit failure rolls back payment instead of committing an untraceable deduction', async () => {
  const f = fixture(); f.failAudit();
  await assert.rejects(f.operations.update('s1', paid, admin), /audit unavailable/);
  assert.equal(f.state().owner.wallet, 100);
  assert.equal(f.state().settlement.status, 'APPROVED');
});
test('completed payouts cannot be reopened or refunded by editing status', async () => {
  const f = fixture(); await f.operations.update('s1', paid, admin);
  await assert.rejects(f.operations.update('s1', { status: 'PENDING' }, admin), /Cannot change/);
  assert.equal(f.state().owner.wallet, 25);
});
test('payment requires prior approval, reference and receipt', async () => {
  const f = fixture();
  await assert.rejects(f.operations.update('s1', { status: 'COMPLETED' }, admin), /reference and receipt/);
  f.setStatus('PENDING');
  await assert.rejects(f.operations.update('s1', paid, admin), /Cannot change/);
});
test('patients and unconfigured doctor payouts cannot use the legacy request path', async () => {
  const f = fixture();
  await assert.rejects(f.operations.create({ amount: 75 }, { id: 'p', role: 'PATIENT' }), /Settlement requests/);
  await assert.rejects(f.operations.create({ amount: 75 }, { id: 'm', role: 'MANAGER' }), /Settlement requests/);
  await assert.rejects(f.operations.create({ amount: 75 }, { id: 'd', role: 'DOCTOR' }), /remote consultations/);
});
test('invalid status names and invalid receipt URLs are rejected without payment', async () => {
  const f = fixture();
  for (const status of ['__proto__', 'toString', 'UNKNOWN']) {
    await assert.rejects(f.operations.update('s1', { ...paid, status }, admin), /Invalid settlement status/);
  }
  await assert.rejects(f.operations.update('s1', { ...paid, receiptUrl: 'javascript:alert(1)' }, admin), /HTTP/);
  await assert.rejects(f.operations.update('s1', { ...paid, reference: 123 }, admin), /must be text/);
  assert.equal(f.state().owner.wallet, 100);
});
test('clinic staff cannot mark a settlement paid', async () => {
  const f = fixture();
  await assert.rejects(f.operations.update('s1', paid, { id: 'm', role: 'MANAGER' }), /Only Main Admin/);
  assert.equal(f.state().owner.wallet, 100);
});
test('payment cannot spend frozen funds or other pending settlements', async () => {
  for (const reserve of ['setFrozen', 'setReserved']) {
    const f = fixture(); f[reserve](30);
    await assert.rejects(f.operations.update('s1', paid, admin), /Insufficient/);
    assert.equal(f.state().owner.wallet, 100);
    assert.equal(f.state().settlement.status, 'APPROVED');
  }
});
test('serialization conflicts are returned as a retryable conflict, never a second payment', async () => {
  const operations = settlementOperations({ $transaction: async () => { throw { code: 'P2034' }; } });
  await assert.rejects(operations.update('s1', paid, admin), error => error.statusCode === 409);
});
test('fractional frozen funds do not cause a false insufficient balance', async () => {
  const f = fixture(); f.setAmount(0.1); f.setFrozen(0.2); f.setWallet(0.3);
  await f.operations.update('s1', paid, admin);
  assert.equal(f.state().settlement.status, 'COMPLETED');
  assert.ok(Math.abs(f.state().owner.wallet - 0.2) < 0.000001);
});
test('legacy settlement amounts are never silently rounded to a different paid amount', async () => {
  const f = fixture(); f.setAmount(75.005);
  await assert.rejects(f.operations.update('s1', paid, admin), /Historical settlement/);
  assert.equal(f.state().owner.wallet, 100);
  assert.equal(f.state().settlement.amount, 75.005);
  assert.equal(f.state().settlement.status, 'APPROVED');
  assert.equal(f.state().journals.length, 0);
});
