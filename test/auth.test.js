import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OUTREACH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-auth-'));
process.env.APP_PASSWORD = 'test-secret';
const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

const withPassword = (pass) => ({
  headers: { Authorization: 'Basic ' + Buffer.from(`user:${pass}`).toString('base64') }
});

test('requests without credentials are rejected', async () => {
  const res = await fetch(base + '/api/contacts');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') || '', /Basic/);
});

test('wrong password is rejected, including wrong-length passwords', async () => {
  assert.equal((await fetch(base + '/api/contacts', withPassword('wrong'))).status, 401);
  assert.equal((await fetch(base + '/api/contacts', withPassword('test-secret-longer'))).status, 401);
  assert.equal((await fetch(base + '/api/contacts', withPassword(''))).status, 401);
});

test('correct password is accepted', async () => {
  const res = await fetch(base + '/api/contacts', withPassword('test-secret'));
  assert.equal(res.status, 200);
});

test('health endpoint stays reachable without credentials', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
});
