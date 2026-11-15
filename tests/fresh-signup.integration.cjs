// Fresh HTTP signup and actual database onboarding; provider delivery is simulated.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const db = new PrismaClient({ datasources: { db: { url: require('./phase-one-test-db.cjs').testUrl } } });
const secret = 'synthetic-fresh-signup-test';
const noop = new Proxy({}, { get: () => async () => undefined });
const pass = (_req, _res, next) => next();
const original = Module._load;
Module._load = function (request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: db };
  if (/(?:^|\/)config$/.test(request)) return { __esModule: true, default: {
    jwt: { jwt_secret: secret, expires_in: '5m', refresh_token_secret: secret + '-refresh', refresh_token_expires_in: '10m' }, twilio: {},
  } };
  if (request === 'twilio') return { __esModule: true, default: () => ({ verify: { v2: { services: () => ({
    verifications: { create: async () => ({ status: 'pending' }) },
    verificationChecks: { create: async ({ code }) => ({ status: code === '654321' ? 'approved' : 'pending' }) },
  }) } } }) };
  if (request.endsWith('/helpars/stripe/stripe')) return { __esModule: true, default: {} };
  if (request.endsWith('/emailSender/emailSender')) return { __esModule: true, default: async () => {} };
  if (request.endsWith('/bookingScheduler.service')) return { BookingSchedulerService: noop };
  if (request.endsWith('/jobs')) return { adminNotificationQueue: noop };
  if (request.endsWith('/notification.service')) return { Notification: noop };
  if (request.endsWith('/socketHandler')) return { broadcastBookingUpdate() {} };
  if (request.endsWith('/firebase/firebase')) return { __esModule: true, default: { messaging: () => ({ send: async () => {} }) } };
  if (request.endsWith('/s3Bucket/fileUploadToS3')) return { s3Uploader: { single: () => pass, fields: () => pass } };
  if (request.endsWith('/uploadFile/file.upload')) return { getPrivateFileUrl: async () => { throw Error('Storage is outside the signup test'); } };
  return original.call(this, request, parent, main);
};
let AuthRoutes, PatientRoutes, DoctorRoutes, ClinicRoutes;
try {
  ({ AuthRoutes } = require('../src/app/modules/Auth/auth.routes'));
  ({ PatientRoutes } = require('../src/app/modules/Patient/patient.routes'));
  ({ DoctorRoutes } = require('../src/app/modules/Doctor/doctor.routes'));
  ({ ClinicRoutes } = require('../src/app/modules/Clinic/clinic.routes'));
} finally { Module._load = original; }
let server, base;
before(async () => {
  const app = express(); app.use(express.json());
  app.use('/auth', AuthRoutes); app.use('/patient', PatientRoutes); app.use('/doctor', DoctorRoutes); app.use('/clinic', ClinicRoutes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
async function call(path, body, token, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('new Patient, Doctor and Clinic accounts complete the actual OTP/profile HTTP routes', async () => {
  for (const role of ['PATIENT', 'DOCTOR', 'CLINIC']) {
    const phoneNumber = '+2189' + String(Date.now()).slice(-8) + String(['PATIENT', 'DOCTOR', 'CLINIC'].indexOf(role));
    const sent = await call('/auth/send-otp', { phoneNumber });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const rejected = await call('/auth/verify-otp', { phoneNumber, otp: '123456' });
    assert.equal(rejected.status, 400);
    const verified = await call('/auth/verify-otp', { phoneNumber, otp: '654321' });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.data.role, null);
    const token = verified.body.data.accessToken;
    const id = jwt.verify(token, secret).id;
    const path = role === 'CLINIC' ? '/clinic/update-info' : '/' + role.toLowerCase() + '/profile-update';
    const profile = { fullName: 'Synthetic ' + role, country: 'LIBYA', city: 'Tripoli', address: 'Synthetic test address', profileCompleted: true,
      email: randomUUID() + '@example.test', speciality: 'General', clinicName: 'Synthetic fresh clinic', timezone: 'Africa/Tripoli' };
    const saved = await call(path, { data: JSON.stringify(profile) }, token, 'PATCH');
    assert.equal(saved.status, 200, role + ': ' + JSON.stringify(saved.body));
    const user = await db.user.findUnique({ where: { id }, include: { patient: true, doctor: true, clinic: true } });
    assert.equal(user.role, role); assert.equal(user.profileCompleted, true);
    assert.ok(user[role.toLowerCase()]);
    assert.equal(jwt.verify(user.accessToken, secret).role, role);
    if (role === 'DOCTOR' || role === 'CLINIC') {
      assert.equal(user[role.toLowerCase()].adminVerified, false);
      assert.equal(user[role.toLowerCase()].badgeActive, false);
    }
    const otherPath = role === 'PATIENT' ? '/doctor/profile-update' : '/patient/profile-update';
    const switched = await call(otherPath, { data: JSON.stringify(profile) }, token, 'PATCH');
    assert.equal(switched.status, 403, role + ' must not switch registration roles');
    assert.equal((await db.user.findUnique({ where: { id } })).role, role);
  }
});
