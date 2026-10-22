const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const storage = require('./storageService');

test('local development upload stores bytes and removes them cleanly', { skip: storage.hasCloudinary ? 'Cloudinary credentials are set; avoiding a real cloud upload in unit tests' : false }, async () => {
  const bytes = Buffer.from('CloudNest storage smoke test');
  const saved = await storage.upload(bytes, 'smoke-test.txt', 'text/plain', 'test-user');
  assert.equal(saved.provider, 'local');
  assert.ok(saved.storageKey);
  const file = { ...saved, storageProvider: saved.provider };
  const localPath = storage.localPath(file);
  assert.ok(localPath);
  assert.equal(fs.readFileSync(localPath).toString(), bytes.toString());
  await storage.remove(file);
  assert.equal(fs.existsSync(localPath), false);
});

test('local path rejects missing storage keys', () => {
  assert.equal(storage.localPath(null), null);
  assert.equal(storage.localPath({}), null);
});
