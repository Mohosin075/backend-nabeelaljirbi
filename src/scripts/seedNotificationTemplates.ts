import { NotificationTemplateService } from '../app/modules/NotificationTemplate/notificationTemplate.service';
import prisma from '../shared/prisma';

async function main() {
  console.log('🌱 Seeding notification templates...');
  await NotificationTemplateService.seedDefaultTemplates();
  const count = await prisma.notificationTemplate.count();
  console.log(`✅ Successfully seeded ${count} notification templates!`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
