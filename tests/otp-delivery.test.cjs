// Exercise the real authentication service without sending any external messages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let settings = { WhatsApp: true, SMS: false }, fail = false, failWhatsapp = false;
const deliveries = [], writes = [];
const original = Module._load;
Module._load = function (request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: {
    user: { findUnique: async () => null, upsert: async data => { writes.push(data); return {}; } },
    oTPSystem: { findFirst: async () => settings },
  } };
  if (/(?:^|\/)config$/.test(request)) return { __esModule: true, default: { twilio: {} } };
  if (request === 'twilio') return { __esModule: true, default: () => ({ verify: { v2: { services: () => ({
    verifications: { create: async ({ channel }) => {
      deliveries.push(channel);
      if (fail || (failWhatsapp && channel === 'whatsapp')) throw { code: 'synthetic-unavailable' };
      return { status: 'pending' };
    } },
  }) } } }) };
  if (request.endsWith('/emailSender/emailSender')) return { __esModule: true, default: async () => {} };
  return original.call(this, request, parent, main);
};
let service;
try { service = require('../src/app/modules/Auth/auth.service').AuthServices; }
finally { Module._load = original; }

test('failed provider delivery never reports success or creates an account', async () => {
  fail = true;
  await assert.rejects(service.sendOTP('+218900000001'), error => error.statusCode === 503);
  assert.deepEqual(deliveries.splice(0), ['whatsapp']);
  assert.equal(writes.length, 0);
  fail = false;
});

test('successful signup stores no undelivered local challenge', async () => {
  const result = await service.sendOTP('+218900000001');
  assert.equal(result.channel, 'whatsapp');
  assert.deepEqual(deliveries.splice(0), ['whatsapp']);
  const saved = writes.pop();
  assert.equal(saved.create.phoneNumber, '+218900000001');
  assert.equal(saved.create.otp, undefined);
  assert.deepEqual(saved.update, { otp: null, otpExpiresAt: null });
});

test('SMS fallback is used only when enabled and both-disabled fails closed', async () => {
  settings = { WhatsApp: true, SMS: true }; failWhatsapp = true;
  assert.equal((await service.sendOTP('+218900000001')).channel, 'sms');
  assert.deepEqual(deliveries.splice(0), ['whatsapp', 'sms']);
  writes.length = 0;
  settings = { WhatsApp: false, SMS: false };
  for (const requested of [undefined, 'sms', 'whatsapp']) {
    await assert.rejects(service.sendOTP('+218900000001', requested), error => error.statusCode === 503);
  }
  assert.equal(deliveries.length, 0);
  assert.equal(writes.length, 0);
});

test('invalid phone input is rejected before provider delivery', async () => {
  for (const phone of [undefined, '', '1234567890', '+invalid']) {
    await assert.rejects(service.sendOTP(phone), error => error.statusCode === 400);
  }
  assert.equal(deliveries.length, 0);
});
