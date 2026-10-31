const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createTestApp, db } = require('./phase-one-http-server.cjs');
let server, base;
before(async () => { server = await new Promise(resolve => { const s = createTestApp().listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}/api/v1/phase-one`; });
after(async () => { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
const request = (path, actor = 'phase1-clinic-user', options = {}) => fetch(base + path, { ...options, headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json', ...options.headers } });
test('HTTP routes require an active account and scope booking options', async () => {
  assert.equal((await request('/bookings', 'missing')).status, 401);
  const clinic = await (await request('/booking-options')).json();
  assert.deepEqual(clinic.data.clinics.map(c => c.id), ['phase1-clinic']);
  assert.ok(clinic.data.patients.some(p => p.id === 'phase1-patient'));
  const outside = await (await request('/booking-options?clinicId=phase1-other-clinic')).json();
  assert.deepEqual(outside.data.patients, []);
  assert.deepEqual((await (await request('/booking-options?patientSearch=not-a-patient')).json()).data.patients, []);
  const admin = await (await request('/booking-options', 'phase1-admin')).json();
  assert.ok(admin.data.clinics.length >= 2);
});
test('HTTP privilege escalation and cross-clinic staff requests are denied', async () => {
  assert.equal((await request('/accounts/phase1-doctor-user/controls', 'phase1-clinic-user', { method: 'PATCH', body: JSON.stringify({ remoteConsultationsEnabled: true }) })).status, 403);
  assert.equal((await request('/country-fees', 'phase1-patient-user')).status, 403);
  assert.equal((await request('/bookings/bulk', 'phase1-patient-user', { method: 'POST', body: JSON.stringify({ ids: ['phase1-legacy-booking'], action: 'CONFIRMED' }) })).status, 403);
});
test('Excel download preserves status filters and exports the matching dataset', async () => {
  const response = await request('/reports/bookings/xlsx?status=PENDING&limit=1');
  assert.equal(response.status, 200);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = book.worksheets[0];
  assert.equal(sheet.rowCount, 4);
  assert.match(sheet.getRow(2).getCell(1).text, /status: PENDING/);
  assert.match(sheet.getRow(4).getCell(2).text, /PENDING/);
  assert.equal((await request('/reports/bookings/pdf', 'phase1-patient-user')).status, 403);
});
test('PDF download is a valid scoped document and patient complaint output excludes internal notes', async () => {
  const pdf = await request('/reports/bookings/pdf?status=PENDING');
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const response = await (await request('/my-complaints', 'phase1-patient-user')).json();
  assert.ok(response.data.data.length); assert.ok(response.data.data.every(c => !Object.hasOwn(c, 'adminNotes')));
});
