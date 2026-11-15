// Explicit provider smoke check: one unique synthetic receipt, removed in finally.
// No application database, real settlements or other stored files are touched.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, uploadToS3, getPrivateFileUrl } = require('../src/app/modules/uploadFile/file.upload');

(async () => {
  let key;
  const content = Buffer.from('%PDF-1.4\n% Synthetic Salama storage connectivity receipt. No patient data.\n%%EOF\n');
  try {
    key = await uploadToS3('settlement-receipts/qa-' + randomUUID(), {
      originalname: 'synthetic-storage-check.pdf', mimetype: 'application/pdf', buffer: content,
    });
    const signed = await getPrivateFileUrl(key);
    const result = await fetch(signed, { signal: AbortSignal.timeout(20000) });
    assert.equal(result.status, 200, 'Signed download must succeed');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), content);
    const anonymous = new URL(signed); anonymous.search = '';
    const denied = await fetch(anonymous, { signal: AbortSignal.timeout(20000) });
    assert.ok([401, 403, 404].includes(denied.status), 'Anonymous receipt download must be denied');
    console.log(JSON.stringify({ upload: 'passed', signedDownload: 'passed', bytesMatch: true, anonymousAccess: 'denied', anonymousStatus: denied.status }));
  } finally {
    if (key) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }));
      console.log('Synthetic QA receipt removed');
    }
    s3.destroy();
  }
})().catch(error => { console.error('Receipt storage check failed:', error.name, error.$metadata?.httpStatusCode || error.code || '', error.message); process.exitCode = 1; });
