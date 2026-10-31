const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const Module = require('node:module');
const db = new PrismaClient({ datasources: { db: { url: require('./phase-one-test-db.cjs').testUrl } } });
// Keep real lifecycle services and PostgreSQL transactions, replacing only
// external delivery/scheduler/bootstrap dependencies. Never import production DB.
const originalLoad = Module._load;
const noopService = new Proxy({}, { get: () => async () => undefined });
Module._load = function(request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: db };
  if (request.endsWith('/bookingScheduler.service')) return { BookingSchedulerService: noopService };
  if (request.endsWith('/notification.service')) return { Notification: noopService };
  if (request.endsWith('/notificationTemplate.service')) return { NotificationTemplateService: { renderNotification: async () => ({ title: 'Test notification', body: 'Synthetic booking update', pushEnabled: false }) } };
  if (request.endsWith('/socketHandler')) return { broadcastBookingUpdate() {} };
  if (request.endsWith('/Auth/auth.service')) return { generateTokens() { return { accessToken: 'isolated-test-token' }; } };
  return originalLoad.call(this, request, parent, main);
};
const { BookingService } = require('../src/app/modules/Booking/booking.service');
const { ClinicService } = require('../src/app/modules/Clinic/clinic.service');
const { DoctorService } = require('../src/app/modules/Doctor/doctor.service');
Module._load = originalLoad;
const { bookingOperations } = require('../src/app/modules/PhaseOne/booking.operations');
const ops = bookingOperations(db, { transition: ClinicService.updateAppointmentStatus, cancel: BookingService.cancelBooking });
let patient, owner, clinic, doctor, admin;
before(async () => {
  const stamp = Date.now();
  patient = await db.user.create({ data: { phoneNumber: `+201${stamp}`, fullName: 'Lifecycle Patient', role: 'PATIENT', wallet: 1000, patient: { create: {} } }, include: { patient: true } });
  owner = await db.user.create({ data: { phoneNumber: `+202${stamp}`, fullName: 'Lifecycle Clinic', role: 'CLINIC', country: 'LIBYA', wallet: 100, clinic: { create: { clinicName: 'Lifecycle Test Clinic', adminVerified: true, timezone: 'Africa/Tripoli' } } }, include: { clinic: true } });
  clinic = owner.clinic;
  doctor = await db.doctor.findUnique({ where: { id: 'phase1-doctor' } });
  admin = await db.user.findUnique({ where: { id: 'phase1-admin' } });
});
after(() => db.$disconnect());
async function pending(mode, date = new Date(Date.now() + 86400000)) {
  const hold = mode === 'MODE_B' ? 83.05 : 7.55;
  return db.$transaction(async tx => {
    await tx.user.update({ where: { id: patient.id }, data: { frozenWallet: { increment: hold } } });
    return tx.bookingAppointment.create({ data: { patientId: patient.patient.id, doctorId: doctor.id, clinicId: clinic.id, consultDate: date, startTime: '23:00', serialNumber: 1, holdAmount: hold, serviceFeeAmount: 7.55, patientServiceFee: 7.55, consultFee: 75.5, clinicServiceFee: 0, collectionMode: mode, feeCountry: 'LIBYA' } });
  });
}
test('pending doctor absence releases full hold and records cancellation and a patient notification', async () => {
  const b = await pending('MODE_B');
  const before = await db.user.findUnique({ where: { id: patient.id } });
  const result = await BookingService.cancelBooking(b.id, owner.id, 'CLINIC', 'Doctor unavailable', 'DOCTOR_ABSENT');
  const after = await db.user.findUnique({ where: { id: patient.id } });
  assert.equal(result.status, 'CANCELLED'); assert.equal(result.absenceType, 'DOCTOR_ABSENT');
  assert.equal(after.wallet, before.wallet); assert.equal(after.frozenWallet, before.frozenWallet - b.holdAmount);
  assert.ok(await db.patientNotification.count({ where: { bookingAppointmentId: b.id } }));
  await assert.rejects(BookingService.cancelBooking(b.id, owner.id, 'CLINIC', 'Repeat', 'DOCTOR_ABSENT'), /Cannot cancel/);
});
for (const mode of ['MODE_A', 'MODE_B']) test(`${mode}: confirmation captures once; doctor absence after arrival follows normal refund rules`, async () => {
  const b = await pending(mode, new Date(Date.now() - 86400000));
  const before = await db.user.findUnique({ where: { id: patient.id } });
  await BookingService.confirmBooking(b.id, owner.id, 'CLINIC');
  await assert.rejects(BookingService.confirmBooking(b.id, owner.id, 'CLINIC'), /Cannot confirm/);
  await ClinicService.updateAppointmentStatus(owner.id, b.id, 'ARRIVED', undefined, 'CLINIC');
  await BookingService.cancelBooking(b.id, owner.id, 'CLINIC', 'Doctor absent after arrival', 'DOCTOR_ABSENT');
  const after = await db.user.findUnique({ where: { id: patient.id } });
  assert.ok(Math.abs(after.wallet - (before.wallet - 7.55)) < 1e-8);
  assert.equal(after.frozenWallet, 0);
  assert.equal(await db.topUp.count({ where: { id: `booking:${b.id}:patient:debit` } }), 1);
  assert.equal(await db.topUp.count({ where: { id: `booking:${b.id}:refund:credit` } }), mode === 'MODE_B' ? 1 : 0);
});
test('bulk actions reject cross-clinic selection before any change; too-early arrival fails explicitly', async () => {
  const b = await pending('MODE_A');
  await assert.rejects(ops.bulk({ id: owner.id, role: 'CLINIC' }, { ids: [b.id, 'phase1-legacy-booking'], action: 'CONFIRMED' }), /outside your scope/);
  assert.equal((await db.bookingAppointment.findUnique({ where: { id: b.id } })).status, 'PENDING');
  assert.equal((await ops.bulk({ id: owner.id, role: 'CLINIC' }, { ids: [b.id], action: 'CONFIRMED' })).successCount, 1);
  const early = await ops.bulk({ id: owner.id, role: 'CLINIC' }, { ids: [b.id], action: 'ARRIVED' });
  assert.equal(early.failureCount, 1); assert.match(early.results[0].message, /hours before/);
  const cancelled = await ops.bulk({ id: owner.id, role: 'CLINIC' }, { ids: [b.id], action: 'CANCELLED', reason: 'Clinic closed' });
  assert.equal(cancelled.successCount, 1);
  assert.equal((await ops.bulk({ id: owner.id, role: 'CLINIC' }, { ids: [b.id], action: 'CANCELLED', reason: 'Repeat' })).results[0].skipped, true);
  const list = await ops.list({ id: patient.id, role: 'PATIENT' }, { status: 'DOCTOR_ABSENT', limit: 1000 });
  assert.ok(list.data.length >= 3); assert.ok(list.data.every(row => row.patientId === patient.patient.id && row.displayStatus === 'DOCTOR_ABSENT'));
});
test('legacy biography qualification alias cannot bypass an approved doctor profile lock', async () => {
  await assert.rejects(DoctorService.updateDoctorProfile('phase1-doctor-user', { biography: '[{"degree":"Unreviewed"}]' }), /locked/);
  assert.equal((await db.doctor.findUnique({ where: { id: doctor.id } })).qualifications, doctor.qualifications);
});
test('manual bulk confirm, arrive and complete work for both models without charging again on completion', async () => {
  const bookings = [await pending('MODE_A', new Date(Date.now() - 86400000)), await pending('MODE_B', new Date(Date.now() - 86400000))];
  const actor = { id: owner.id, role: 'CLINIC' }, ids = bookings.map(b => b.id);
  assert.equal((await ops.bulk(actor, { ids, action: 'CONFIRMED' })).successCount, 2);
  const charged = await db.user.findUnique({ where: { id: patient.id } });
  assert.equal((await ops.bulk(actor, { ids, action: 'ARRIVED' })).successCount, 2);
  assert.equal((await ops.bulk(actor, { ids, action: 'COMPLETE' })).successCount, 2);
  const after = await db.user.findUnique({ where: { id: patient.id } });
  assert.equal(after.wallet, charged.wallet); assert.equal(after.frozenWallet, charged.frozenWallet);
  assert.ok((await ops.bulk(actor, { ids, action: 'COMPLETE' })).results.every(r => r.skipped));
  assert.equal(await db.bookingAppointment.count({ where: { id: { in: ids }, status: 'COMPLETE' } }), 2);
});
test('patient no-show retains separate metadata and cannot later be reclassified for another refund', async () => {
  const booking = await pending('MODE_A', new Date(Date.now() - 86400000));
  await BookingService.confirmBooking(booking.id, owner.id, 'CLINIC');
  const actor = { id: owner.id, role: 'CLINIC' };
  assert.equal((await ops.bulk(actor, { ids: [booking.id], action: 'PATIENT_NO_SHOW', reason: 'Patient did not attend' })).successCount, 1);
  const saved = await db.bookingAppointment.findUnique({ where: { id: booking.id } });
  assert.equal(saved.status, 'NOT_SHOW'); assert.equal(saved.absenceType, 'PATIENT_NO_SHOW');
  assert.equal((await ops.bulk(actor, { ids: [booking.id], action: 'DOCTOR_ABSENT', reason: 'Attempt reclassification' })).failureCount, 1);
});
test('actual booking creation snapshots clinic-country rules for both models in every supported country', async () => {
  await db.doctorClinic.create({ data: { doctorId: doctor.id, clinicId: clinic.id } });
  const date = new Date(Date.now() + 86400000); date.setUTCHours(0, 0, 0, 0);
  const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][date.getUTCDay()];
  const working = await db.workingDay.create({ data: { doctorId: doctor.id, clinicId: clinic.id, day, slots: { create: { startTime: '12:00', endTime: '15:00', capacity: 20 } } }, include: { slots: true } });
  for (const country of ['LIBYA', 'TUNISIA', 'EGYPT', 'ALGERIA']) {
    await db.user.update({ where: { id: owner.id }, data: { country } });
    await db.patientServiceFee.upsert({ where: { country }, create: { country, amount: 3, modelBPercentage: 10, clinicFeePercentage: 5 }, update: { amount: 3, modelBPercentage: 10, clinicFeePercentage: 5 } });
    for (const mode of ['MODE_A', 'MODE_B']) {
      await db.clinic.update({ where: { id: clinic.id }, data: { collectionMode: mode, trial: false } });
      const before = await db.user.findUnique({ where: { id: patient.id } });
      const booking = await BookingService.createBooking(patient.id, { clinicId: clinic.id, doctorId: doctor.id, workingSlotId: working.slots[0].id, consultDate: date });
      assert.equal(booking.feeCountry, country); assert.equal(booking.collectionMode, mode);
      assert.equal(booking.serviceFeeAmount, mode === 'MODE_A' ? 3 : 7.55);
      assert.equal(booking.clinicServiceFee, 3.78);
      assert.equal(booking.holdAmount, mode === 'MODE_A' ? 3 : 83.05);
      await BookingService.cancelBooking(booking.id, owner.id, 'CLINIC', 'Synthetic matrix cleanup', 'DOCTOR_ABSENT');
      const after = await db.user.findUnique({ where: { id: patient.id } });
      assert.equal(after.wallet, before.wallet); assert.ok(Math.abs(after.frozenWallet - before.frozenWallet) < 1e-8);
      assert.ok(Math.abs((await db.user.findUnique({ where: { id: owner.id } })).frozenWallet) < 1e-8);
    }
  }
});
