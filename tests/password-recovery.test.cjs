const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const bcrypt = require('bcrypt');
let current, emailFail = false, phoneFail = false, approved = false;
const deliveries = [], emails = [];
const original = Module._load;
Module._load = function (request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: {
    user: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where.role.in, ['ADMIN', 'CLINIC', 'MANAGER', 'DOCTOR']);
        return where.OR.some(filter => filter.phoneNumber === current.phoneNumber || filter.email?.equals === current.email) ? current : null;
      },
      update: async ({ data }) => { current = { ...current, ...data }; return current; },
    }, oTPSystem: { findFirst: async () => ({ WhatsApp: true, SMS: false }) },
  } };
  if (/(?:^|\/)config$/.test(request)) return { __esModule: true, default: { twilio: {} } };
  if (request === 'twilio') return { __esModule: true, default: () => ({ verify: { v2: { services: () => ({
    verifications: { create: async args => { if (phoneFail) throw Error('synthetic failure'); deliveries.push(args); return { status: 'pending' }; } },
    verificationChecks: { create: async args => { deliveries.push(args); return { status: approved ? 'approved' : 'pending' }; } },
  }) } } }) };
  if (request.endsWith('/emailSender/emailSender')) return { __esModule: true, default: async (...args) => {
    if (emailFail) throw Error('synthetic failure'); emails.push(args);
  } };
  return original.call(this, request, parent, main);
};
let service;
try { service = require('../src/app/modules/Auth/auth.service').AuthServices; }
finally { Module._load = original; }
const account = role => ({ id: 'qa-' + role, role, status: 'ACTIVE', banned: false,
  email: role.toLowerCase() + '@example.test', phoneNumber: '+218900000001' });

test('every dashboard role can recover by email, bound to its own account, once', async () => {
  for (const role of ['ADMIN', 'CLINIC', 'MANAGER', 'DOCTOR']) {
    current = account(role);
    await service.forgotPassword({ emailOrPhone: current.email });
    const token = current.passwordResetToken;
    assert.match(token, /^\d{6}$/);
    assert.ok(emails.at(-1)[2].includes(token));
    await assert.rejects(service.resetPassword({ emailOrPhone: 'other@example.test', token, newPassword: 'New-Password-123' }), /Invalid or expired/);
    const payload = { emailOrPhone: current.email, token, newPassword: 'New-Password-123' };
    await service.resetPassword(payload);
    assert.ok(await bcrypt.compare(payload.newPassword, current.password));
    assert.equal(current.refreshToken, null);
    await assert.rejects(service.resetPassword(payload), /Invalid or expired/);
  }
  assert.equal(deliveries.length, 0, 'Email recovery must remain independent of phone delivery');
});

test('phone recovery checks the actual provider code for the selected account', async () => {
  current = account('CLINIC');
  await service.forgotPassword({ emailOrPhone: current.phoneNumber });
  assert.ok(current.passwordResetToken.startsWith('phone:'));
  assert.equal(deliveries.at(-1).channel, 'whatsapp');
  const payload = { emailOrPhone: current.phoneNumber, token: '654321', newPassword: 'New-Password-123' };
  await assert.rejects(service.resetPassword(payload), /Invalid or expired/);
  approved = true;
  await service.resetPassword(payload);
  assert.equal(deliveries.at(-1).to, current.phoneNumber);
});

test('delivery errors and inactive accounts never create a usable recovery challenge', async () => {
  current = account('ADMIN'); emailFail = true;
  await assert.rejects(service.forgotPassword({ emailOrPhone: current.email }), error => error.statusCode === 503);
  assert.equal(current.passwordResetToken, undefined); emailFail = false;
  phoneFail = true;
  await assert.rejects(service.forgotPassword({ emailOrPhone: current.phoneNumber }), error => error.statusCode === 503);
  assert.equal(current.passwordResetToken, undefined); phoneFail = false;
  current.status = 'SUSPENDED';
  await assert.rejects(service.forgotPassword({ emailOrPhone: current.email }), error => error.statusCode === 403);
});
