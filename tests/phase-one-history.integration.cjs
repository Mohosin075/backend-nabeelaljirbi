const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { historyOperations } = require('../src/app/modules/PhaseOne/history.operations');
const { settlementOperations } = require('../src/app/modules/Admin/settlement.operations');
const db = new PrismaClient({ datasources: { db: { url: require('./phase-one-test-db.cjs').testUrl } } });
const ops = historyOperations(db), payouts = settlementOperations(db);
const clinic = { id: 'phase1-clinic-user', role: 'CLINIC' }, patient = { id: 'phase1-patient-user', role: 'PATIENT' }, admin = { id: 'phase1-admin', role: 'ADMIN', adminTier: 'SUPER_ADMIN' };
after(() => db.$disconnect());
test('complaint tracking is scoped to the complainant and excludes internal notes', async () => {
  const complaint = await db.complaint.create({ data: { complaintNumber: `TEST-${randomUUID()}`, complainantId: patient.id, complainantRole: 'PATIENT', targetType: 'SYSTEM', subject: 'Synthetic complaint', description: 'Synthetic test', status: 'RESOLVED', adminNotes: 'Private investigation', resolution: 'Public resolution' } });
  const mine = await ops.complaints(patient, { status: 'RESOLVED' });
  assert.equal(mine.data.find(row => row.id === complaint.id).resolution, 'Public resolution');
  assert.equal(mine.data[0].adminNotes, undefined);
  assert.ok(!(await ops.complaints(clinic, {})).data.some(row => row.id === complaint.id));
});
test('wallet filters use own records and reject invalid types/ranges', async () => {
  await db.topUp.create({ data: { userId: patient.id, type: 'RECHARGE', amount: 12 } });
  const result = await ops.wallet(patient, { type: 'RECHARGE', limit: 1000 });
  assert.ok(result.data.length); assert.ok(result.data.every(r => r.userId === patient.id && r.direction === 'CREDIT'));
  await assert.rejects(ops.wallet(patient, { type: 'INVALID' }), /Invalid wallet/);
  await assert.rejects(ops.wallet(patient, { startDate: '2026-11-05', endDate: '2026-10-01' }), /Start date/);
  await assert.rejects(ops.wallet({ role: 'MANAGER' }, {}), /cannot access/);
});
test('monitoring requires finance access and retains unspecified historical country', async () => {
  await assert.rejects(ops.monitoring(clinic, {}), /permission/);
  const result = await ops.monitoring(admin, {});
  assert.ok(result.bookingGroups.some(g => g.country === 'HISTORICAL_UNSPECIFIED'));
  assert.ok(result.walletsByCountry.some(g => g.country === 'LIBYA'));
  const captured = await db.adminTransaction.aggregate({ _sum: { totalAmount: true } });
  assert.ok(Math.abs(result.capturedFeesByCountry.reduce((n, g) => n + g.total, 0) - (captured._sum.totalAmount || 0)) < 1e-8);
});
test('concurrent payment completion creates exactly one debit and cannot reopen the request', async () => {
  const before = (await db.user.findUnique({ where: { id: clinic.id } })).wallet;
  const request = await payouts.create({ amount: 3, payoutMethod: 'CASH' }, clinic);
  await payouts.update(request.id, { status: 'APPROVED' }, admin);
  const payload = { status: 'COMPLETED', reference: 'SYNTHETIC-CASH', receiptUrl: 'https://example.test/cash-receipt.pdf' };
  const results = await Promise.allSettled([payouts.update(request.id, payload, admin), payouts.update(request.id, payload, admin)]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.equal((await db.user.findUnique({ where: { id: clinic.id } })).wallet, before - 3);
  assert.equal(await db.topUp.count({ where: { id: `settlement:${request.id}:debit` } }), 1);
  await payouts.update(request.id, payload, admin);
  assert.equal((await db.user.findUnique({ where: { id: clinic.id } })).wallet, before - 3);
  await assert.rejects(payouts.update(request.id, { status: 'APPROVED' }, admin), /Cannot change/);
});
