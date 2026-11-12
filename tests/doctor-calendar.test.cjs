const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

// Exercise the real controller and service without external providers or a database.
const appointments = [
  { id: 'east-today', doctorId: 'doctor', clinicId: 'east', consultDate: new Date('2030-01-02'), status: 'CONFIRMED' },
  { id: 'west-today', doctorId: 'doctor', clinicId: 'west', consultDate: new Date('2030-01-01'), status: 'CONFIRMED' },
  { id: 'east-yesterday', doctorId: 'doctor', clinicId: 'east', consultDate: new Date('2030-01-01'), status: 'CONFIRMED' },
];
function matches(row, where) {
  if (where.AND && !where.AND.every(condition => matches(row, condition))) return false;
  if (where.OR && !where.OR.some(condition => matches(row, condition))) return false;
  for (const key of ['doctorId', 'clinicId']) {
    if (where[key] !== undefined && row[key] !== where[key]) return false;
  }
  if (where.status && !(where.status.in || [where.status]).includes(row.status)) return false;
  if (where.consultDate?.gte && row.consultDate < where.consultDate.gte) return false;
  if (where.consultDate?.lt && row.consultDate >= where.consultDate.lt) return false;
  if (where.consultDate?.lte && row.consultDate > where.consultDate.lte) return false;
  return true;
}
const db = {
  doctor: { findUnique: async () => ({ id: 'doctor' }) },
  bookingAppointment: {
    findMany: async options => options.distinct
      ? [
          { clinicId: 'east', clinic: { timezone: 'Africa/Tripoli' } },
          { clinicId: 'west', clinic: { timezone: 'America/New_York' } },
        ]
      : appointments.filter(row => matches(row, options.where)),
    count: async ({ where }) => appointments.filter(row => matches(row, where)).length,
    aggregate: async () => ({ _sum: { consultFee: 0 } }),
  },
};
const originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: db };
  if (request.endsWith('/Auth/auth.service')) return { generateTokens() {} };
  if (request.endsWith('/s3Bucket/fileUploadToS3')) return { fileUploadToS3() {} };
  return originalLoad.call(this, request, parent, main);
};
const { DoctorController } = require('../src/app/modules/Doctor/doctor.controller');
Module._load = originalLoad;

test('doctor today API returns the same clinic-local appointments counted by its statistics', async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2030-01-01T23:30:00Z');
  const app = express();
  app.get('/appointments', (req, res, next) => {
    req.user = { id: 'doctor-user', role: 'DOCTOR' };
    next();
  }, DoctorController.getAppointments);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/appointments`;
    const response = await fetch(`${base}?today=true`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.data.map(row => row.id), ['east-today', 'west-today']);
    assert.equal(body.data.meta.total, 2);
    assert.equal(body.data.statistics.todayCount, 2);
    assert.equal(body.data.statistics.totalBookings, 3);

    // Explicit date searches retain their existing meaning.
    const dated = await (await fetch(`${base}?consultDate=2030-01-01`)).json();
    assert.deepEqual(dated.data.data.map(row => row.id), ['west-today', 'east-yesterday']);
  } finally {
    Date.now = originalNow;
    await new Promise(resolve => server.close(resolve));
  }
});
