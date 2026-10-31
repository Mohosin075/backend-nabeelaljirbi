const Module = require('node:module');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const db = new PrismaClient({ datasources: { db: { url: require('./phase-one-test-db.cjs').testUrl } } });
const originalLoad = Module._load;
const noop = new Proxy({}, { get: () => async () => undefined });
Module._load = function(request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: db };
  if (request.endsWith('/middlewares/auth')) return { __esModule: true, default: () => async (req, res, next) => {
    try {
      const id = String(req.headers.authorization || '').replace(/^Bearer /i, '');
      const user = await db.user.findUnique({ where: { id } });
      if (!user || user.banned || user.status !== 'ACTIVE') return res.status(401).json({ success: false, message: 'Test account is inactive or missing' });
      req.user = { ...user, adminTier: user.adminTier || 'SUPER_ADMIN' }; next();
    } catch (e) { next(e); }
  } };
  if (request.endsWith('/bookingScheduler.service')) return { BookingSchedulerService: noop };
  if (request.endsWith('/jobs')) return { adminNotificationQueue: noop };
  if (request.endsWith('/notification.service')) return { Notification: noop };
  if (request.endsWith('/notificationTemplate.service')) return { NotificationTemplateService: { renderNotification: async () => ({ title: 'Synthetic update', body: 'Test booking update', pushEnabled: false }) } };
  if (request.endsWith('/socketHandler')) return { broadcastBookingUpdate() {} };
  if (request.endsWith('/Auth/auth.service')) return { generateTokens: () => ({ accessToken: 'test' }) };
  return originalLoad.call(this, request, parent, main);
};
const routers = ['profile.routes', 'account.routes', 'payout.routes', 'booking.routes', 'settings.routes', 'history.routes', 'report.routes'].map(file => Object.values(require(`../src/app/modules/PhaseOne/${file}`)).find(value => typeof value === 'function' && value.stack));
const { AdminController } = require('../src/app/modules/Admin/admin.controller');
const { ClinicController } = require('../src/app/modules/Clinic/clinic.controller');
const testAuth = Module._load('../middlewares/auth').default();
Module._load = originalLoad;
function createTestApp() {
  const app = express(); app.use(require('cors')()); app.use(express.json());
  for (const router of routers) app.use('/api/v1/phase-one', router);
  app.get('/api/v1/clinic/manager/doctors', testAuth, (req,res,next) => {
    if (!['CLINIC','MANAGER','ADMIN'].includes(req.user.role)) return res.status(403).json({success:false,message:'Clinic staff required'});
    return ClinicController.getClinicManagerDoctor(req,res,next);
  });
  // Local synthetic accounts only. Exercise the real legacy read services too.
  const reads = {
    settlements: AdminController.getSettlements,
    complaints: AdminController.getComplaints,
    'get-clinic': AdminController.getClinics,
    'get-doctor': AdminController.getDoctors,
    'get-patient': AdminController.getPatients,
    'financial-overview': AdminController.getPlatformFinancialOverview,
    'financial-ledger': AdminController.getFinancialLedger,
    stats: AdminController.AdminStats,
  };
  for (const [path, read] of Object.entries(reads)) app.get('/api/v1/admin/' + path, testAuth, async (req, res, next) => {
    try {
      if (req.user.role !== 'ADMIN' && !(path === 'settlements' && req.user.role === 'CLINIC')) return res.status(403).json({ success: false, message: 'Admin required' });
      return read(req, res, next);
    } catch (e) { next(e); }
  });
  app.use((err, req, res, next) => { res.status(err.statusCode || 500).json({ success: false, message: err.message }); });
  return app;
}
module.exports = { createTestApp, db };
if (require.main === module) {
  require('./seed-role-accounts.cjs').seedRoleAccounts(db).then(() => createTestApp().listen(55440, '127.0.0.1', () => console.log('Isolated synthetic test API on 127.0.0.1:55440'))).catch(error=>{console.error(error.message);process.exitCode=1;db.$disconnect();});
}
