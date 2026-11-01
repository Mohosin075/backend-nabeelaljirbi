const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { phaseOneOperations } = require('../src/app/modules/PhaseOne/phaseOne.operations');
const { assertProfileEditable, assertArrivalWindow, bookingFilters, bankDetails } = require('../src/app/modules/PhaseOne/phaseOne.policy');
// Deliberately no .env loading and no application Prisma bootstrap. This URL is
// exclusively the disposable container created for this task, never production.
const { testUrl } = require('./phase-one-test-db.cjs');
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
const operations = phaseOneOperations(db);
const admin = { id: 'phase1-admin', role: 'ADMIN', adminTier: 'SUPER_ADMIN' };
after(async () => db.$disconnect());

test('additive migration applied twice preserves legacy wallet, phone and booking snapshots', async () => {
  const changedUsers = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM phase1_legacy_snapshot s JOIN users u USING(id) WHERE s.wallet IS DISTINCT FROM u.wallet OR s."frozenWallet" IS DISTINCT FROM u."frozenWallet" OR s."phoneNumber" IS DISTINCT FROM u."phoneNumber"');
  const changedBookings = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM phase1_booking_snapshot s JOIN booking_appointments b USING(id) WHERE s."consultFee" IS DISTINCT FROM b."consultFee" OR s."serviceFeeAmount" IS DISTINCT FROM b."serviceFeeAmount" OR s."totalAmount" IS DISTINCT FROM b."totalAmount" OR s.status IS DISTINCT FROM b.status');
  assert.equal(changedUsers[0].count, 0); assert.equal(changedBookings[0].count, 0);
  const legacy = await db.bookingAppointment.findUnique({ where: { id: 'phase1-legacy-booking' } });
  assert.equal(legacy.feeCountry, null); assert.equal(legacy.absenceType, null);
});
test('approved clinic core fields are locked; no-op and non-core writes remain compatible', async () => {
  const access = await operations.access('phase1-clinic-user');
  assert.equal(access.locked, true);
  await assert.rejects(assertProfileEditable(db, 'phase1-clinic-user', { clinicName: 'Unapproved change' }), /locked/);
  await assertProfileEditable(db, 'phase1-clinic-user', { clinicName: access.values.clinicName, about: 'New public description' });
});
test('only explicit patient approval locks a patient; onboarding completion is not retroactively treated as approval', async () => {
  assert.equal((await operations.access('phase1-patient-user')).locked, false);
  await db.user.update({ where: { id: 'phase1-patient-user' }, data: { profileApproved: true } });
  await assert.rejects(assertProfileEditable(db, 'phase1-patient-user', { fullName: 'Changed without approval' }), /locked/);
});
test('profile requests reject privilege escalation fields and non-admin review', async () => {
  await assert.rejects(operations.requestChange('phase1-clinic-user', { changes: { wallet: 10000 } }), /Unsupported/);
  await assert.rejects(operations.reviewChange('missing', { status: 'APPROVED' }, { id: 'phase1-clinic-user', role: 'CLINIC' }), /authorization/);
});
test('authorized approval applies only the requested changes and records an audit without changing money', async () => {
  const owner = await db.user.findUnique({ where: { id: 'phase1-clinic-user' } });
  const request = await operations.requestChange(owner.id, { changes: { clinicName: 'Reviewed Clinic Name' }, reason: 'Correct legal name' });
  const result = await operations.reviewChange(request.id, { status: 'APPROVED', response: 'Verified' }, admin);
  assert.equal(result.status, 'APPROVED');
  assert.equal((await db.clinic.findUnique({ where: { userId: owner.id } })).clinicName, 'Reviewed Clinic Name');
  assert.equal((await db.user.findUnique({ where: { id: owner.id } })).wallet, owner.wallet);
  assert.equal(await db.adminAuditLog.count({ where: { action: 'PROFILE_CHANGE_APPROVED', targetId: owner.id } }), 1);
  await assert.rejects(operations.reviewChange(request.id, { status: 'APPROVED' }, admin), /already reviewed/);
});
test('stale profile requests cannot overwrite a newer admin correction', async () => {
  const request = await operations.requestChange('phase1-clinic-user', { changes: { clinicName: 'Older requested name' } });
  await db.clinic.update({ where: { userId: 'phase1-clinic-user' }, data: { clinicName: 'Newer verified name' } });
  await assert.rejects(operations.reviewChange(request.id, { status: 'APPROVED' }, admin), /changed since/);
  assert.equal((await db.profileChangeRequest.findUnique({ where: { id: request.id } })).status, 'PENDING');
  await operations.reviewChange(request.id, { status: 'REJECTED' }, admin);
});
test('bank profiles validate required identity and cannot be saved by a patient', async () => {
  assert.throws(() => bankDetails({ iban: '', accountNumber: '', beneficiaryName: 'Owner', bankName: 'Test' }), /Save beneficiary/);
  await assert.rejects(operations.saveBank('phase1-patient-user', { iban: 'TEST', accountNumber: '', beneficiaryName: 'Owner', bankName: 'Bank' }), /clinic owners/);
  await operations.saveBank('phase1-clinic-user', { iban: 'TEST-IBAN-1', accountNumber: '', beneficiaryName: 'Clinic Owner', bankName: 'Synthetic Bank' });
  assert.equal((await operations.readBank('phase1-clinic-user')).bankDetails.iban, 'TEST-IBAN-1');
});
test('arrival boundary uses the clinic timezone and allows exactly the configured boundary', () => {
  const booking = { consultDate: new Date('2026-11-01T00:00:00Z'), startTime: '12:00', clinic: { timezone: 'Africa/Tripoli' } };
  assert.throws(() => assertArrivalWindow(booking, 3, Date.parse('2026-11-01T06:59:59Z')), /3 hours/);
  assert.doesNotThrow(() => assertArrivalWindow(booking, 3, Date.parse('2026-11-01T07:00:00Z')));
});
test('country fee changes are atomic and require finance authorization', async () => {
  await assert.rejects(operations.countryFees([{ country: 'LIBYA', amount: 3, modelBPercentage: 10, clinicFeePercentage: 5 }], { role: 'CLINIC' }), /authorization/);
  await operations.countryFees([{ country: 'LIBYA', amount: 3, modelBPercentage: 10, clinicFeePercentage: 5 }], admin);
  await assert.rejects(operations.countryFees([{ country: 'LIBYA', amount: 9, modelBPercentage: 500, clinicFeePercentage: 5 }], admin), /Percentages/);
  assert.equal((await db.patientServiceFee.findUnique({ where: { country: 'LIBYA' } })).amount, 3);
});
test('absence and patient filters remain distinct and date ranges include the whole final day', () => {
  assert.deepEqual(bookingFilters({ status: 'DOCTOR_ABSENT' }), { absenceType: 'DOCTOR_ABSENT' });
  assert.equal(bookingFilters({ status: 'PATIENT_NO_SHOW' }).status, 'NOT_SHOW');
  assert.equal(bookingFilters({ date: '2026-11-01' }).consultDate.lte.toISOString(), '2026-11-01T23:59:59.999Z');
});
test('PDF and Excel report filters retain the existing reconciliation periods, clinic and shift', () => {
  const filters = bookingFilters({ clinicId: 'all', period: 'last_month', shift: 'morning', status: 'COMPLETE' }, new Date('2026-10-31T10:00:00Z'));
  assert.equal(filters.clinicId, undefined);
  assert.equal(filters.consultDate.gte.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(filters.consultDate.lte.toISOString(), '2026-09-30T23:59:59.999Z');
  assert.deepEqual(filters.startTime, { lt: '13:00' });
  assert.equal(filters.status, 'COMPLETE');
});


test('bank profile eligibility requires approved doctor and remote flag together',async()=>{
  const original=await db.user.findUnique({where:{id:'phase1-doctor-user'},include:{doctor:true}});
  try {
    for(const [approved,remote,expected] of [[false,true,false],[true,false,false],[true,true,true]]) {
      await db.doctor.update({where:{userId:original.id},data:{adminVerified:approved}});
      await db.user.update({where:{id:original.id},data:{remoteConsultationsEnabled:remote}});
      const profile=await operations.readBank(original.id);
      assert.equal(profile.withdrawalEligible,expected);
      if(!expected) assert.ok(profile.withdrawalEligibilityReason);
    }
  } finally {
    await db.doctor.update({where:{userId:original.id},data:{adminVerified:original.doctor.adminVerified}});
    await db.user.update({where:{id:original.id},data:{remoteConsultationsEnabled:original.remoteConsultationsEnabled}});
  }
});


test('same-currency Stripe top-up credits once on retries and concurrent delivery',async()=>{
  const {walletTopupOperations}=require('../src/app/modules/Payment/wallet-topup.operations');
  const user=await db.user.create({data:{id:'topup-synthetic-patient',phoneNumber:'topup-synthetic-patient',role:'PATIENT',country:'EGYPT',wallet:0}});
  let charges=0;const received=[];
  const op=walletTopupOperations(db,async input=>{charges++;received.push(input);return {status:'succeeded',currency:input.currency,amount_received:Math.round(input.amount*100),metadata:{walletLedgerId:input.ledgerId}};});
  const payload={amount:50,currency:'EGP',requestId:Date.now()+'-0000000000000001',paymentMethodId:'pm_synthetic'};
  const result=await Promise.all([op(user.id,payload),op(user.id,payload)]);
  assert.ok(result.every(row=>row.success));
  assert.equal((await db.user.findUnique({where:{id:user.id}})).wallet,50);
  assert.equal(await db.topUp.count({where:{userId:user.id}}),1);
  const beforeRetry=charges;await op(user.id,payload);assert.equal(charges,beforeRetry);
  assert.ok(received.every(row=>row.currency==='egp'&&row.amount===50));
  await assert.rejects(op(user.id,{...payload,amount:60}),/already used/);
});

test('unsafe legacy top-ups, unsupported wallet currencies and mismatched provider replies never credit or charge incorrectly',async()=>{
  const {walletTopupOperations}=require('../src/app/modules/Payment/wallet-topup.operations');
  let calls=0; const op=walletTopupOperations(db,async input=>{calls++;return {status:'succeeded',currency:'usd',amount_received:5000,metadata:{walletLedgerId:input.ledgerId}};});
  const payload={amount:50,currency:'EGP',requestId:Date.now()+'-0000000000000002',paymentMethodId:'pm_synthetic'};
  await assert.rejects(op('topup-synthetic-patient',{...payload,currency:undefined}),/Confirm the wallet currency/);
  await assert.rejects(op('topup-synthetic-patient',{...payload,requestId:undefined}),/unique request/);
  await assert.rejects(op('topup-synthetic-patient',{...payload,amount:50.001}),/decimal places/);
  const libya=await db.user.create({data:{phoneNumber:'topup-libya-synthetic',role:'PATIENT',country:'LIBYA'}});
  await assert.rejects(op(libya.id,{...payload,currency:'LYD'}),/unavailable/);
  await assert.rejects(op('topup-synthetic-patient',{...payload,requestId:(Date.now()-24*3600000)+'-0000000000000004'}),/expired/);
  assert.equal(calls,0);
  await assert.rejects(op('topup-synthetic-patient',payload),/verification failed/);
  assert.equal((await db.user.findUnique({where:{id:'topup-synthetic-patient'}})).wallet,50);
  assert.equal(await db.topUp.count({where:{userId:'topup-synthetic-patient'}}),1);
});

test('pending card authorization does not become a successful wallet credit and changed accounts roll back the journal',async()=>{
  const {walletTopupOperations}=require('../src/app/modules/Payment/wallet-topup.operations');
  const payload={amount:5,currency:'DZD',requestId:Date.now()+'-0000000000000003',paymentMethodId:'pm_synthetic'};
  const user=await db.user.create({data:{phoneNumber:'topup-algeria-synthetic',role:'PATIENT',country:'ALGERIA',wallet:0}});
  const pending=await walletTopupOperations(db,async()=>({status:'requires_action'}))(user.id,payload);
  assert.equal(pending.success,false);assert.equal(await db.topUp.count({where:{userId:user.id}}),0);
  const changed=walletTopupOperations(db,async input=>{
    await db.user.update({where:{id:user.id},data:{banned:true}});
    return {status:'succeeded',currency:'dzd',amount_received:500,metadata:{walletLedgerId:input.ledgerId}};
  });
  await assert.rejects(changed(user.id,payload),/Account changed/);
  assert.equal(await db.topUp.count({where:{userId:user.id}}),0);
  assert.equal((await db.user.findUnique({where:{id:user.id}})).wallet,0);
});
