const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const templates = new Map();
const original = Module._load;
Module._load = function (request, parent, main) {
  if (request.endsWith('/shared/prisma')) return { __esModule: true, default: { notificationTemplate: {
    findUnique: async ({ where }) => templates.get(where.eventKey),
    create: async ({ data }) => { templates.set(data.eventKey, data); return data; },
  } } };
  return original.call(this, request, parent, main);
};
let service;
try { service = require('../src/app/modules/NotificationTemplate/notificationTemplate.service').NotificationTemplateService; }
finally { Module._load = original; }
test('every default notification renders independent Arabic and English text with dynamic values', async () => {
  await service.seedDefaultTemplates();
  assert.ok(templates.size >= 10);
  for (const [event, template] of templates) {
    const keys = [...(template.titleEn + template.bodyEn + template.titleAr + template.bodyAr).matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]);
    const variables = Object.fromEntries(keys.map(key => [key, 'بيانات الاختبار']));
    const ar = await service.renderNotification(event, 'ar', variables);
    const en = await service.renderNotification(event, 'en', variables);
    assert.match(ar.title, /[\u0600-\u06ff]/, event);
    assert.match(ar.body, /[\u0600-\u06ff]/, event);
    assert.notEqual(ar.title, en.title, event);
    assert.doesNotMatch(ar.title + ar.body + en.title + en.body, /{{/);
  }
});
