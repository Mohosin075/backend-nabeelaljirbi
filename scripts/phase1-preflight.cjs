// READ ONLY. Use a staging/restored production database first. Never imports
// shared/prisma.ts, which starts application initialization and can create users.
require('dotenv').config();
const { PrismaClient, Country } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  const report = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [clinics, fees, walletTotals, invalidWallets, settlementTotals] = await Promise.all([
      tx.clinic.findMany({ select: { id: true, collectionMode: true, trial: true, serviceFeePercentage: true, user: { select: { country: true, serviceFree: true } } } }),
      tx.patientServiceFee.findMany(),
      tx.user.aggregate({ _sum: { wallet: true, frozenWallet: true }, _count: true }),
      tx.user.count({ where: { OR: [{ wallet: { lt: 0 } }, { frozenWallet: { lt: 0 } }] } }),
      tx.settlement.groupBy({ by: ['status'], _count: true, _sum: { amount: true } }),
    ]);
    const configured = new Set(fees.map(fee => fee.country));
    const issues = clinics.flatMap(clinic => {
      const reasons = [];
      const country = clinic.user.country?.trim().toUpperCase();
      if (!['MODE_A', 'MODE_B'].includes(clinic.collectionMode)) reasons.push('INVALID_MODEL');
      if (clinic.collectionMode === 'MODE_A' && (!country || !Object.values(Country).includes(country) || !configured.has(country))) reasons.push('MODEL_A_COUNTRY_FEE_NOT_CONFIGURED');
      if (clinic.serviceFeePercentage < 0 || clinic.serviceFeePercentage > 100) reasons.push('INVALID_PATIENT_PERCENTAGE');
      if (!clinic.trial && (clinic.user.serviceFree < 0 || clinic.user.serviceFree > 100)) reasons.push('INVALID_CLINIC_PERCENTAGE');
      if (!clinic.trial && clinic.user.serviceFree !== clinic.serviceFeePercentage) reasons.push('REVIEW_SEPARATE_PATIENT_AND_CLINIC_PERCENTAGES');
      return reasons.length ? [{ clinicId: clinic.id, country, reasons }] : [];
    });
    return { clinicCount: clinics.length, configuredFixedFees: fees.map(f => ({ country: f.country, amount: f.amount })), issues, invalidWallets, walletTotals, settlementTotals };
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch(error => { console.error('Preflight failed:', error.code || error.name); process.exitCode = 1; }).finally(() => db.$disconnect());
