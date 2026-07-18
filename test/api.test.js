import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OUTREACH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-api-'));
delete process.env.APP_PASSWORD;
const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

const json = (method, url, body) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

test('health endpoint responds', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('contact CRUD lifecycle', async () => {
  const created = await json('POST', '/api/contacts', { name: 'API Test', company: 'TestCo' });
  assert.equal(created.status, 201);
  const contact = await created.json();

  const updated = await json('PUT', `/api/contacts/${contact.id}`, { role: 'CEO' });
  assert.equal((await updated.json()).role, 'CEO');

  const list = await (await fetch(base + '/api/contacts')).json();
  assert.ok(list.some((c) => c.id === contact.id));

  const deleted = await json('DELETE', `/api/contacts/${contact.id}`);
  assert.equal(deleted.status, 204);
  assert.equal((await json('DELETE', `/api/contacts/${contact.id}`)).status, 404);
});

test('contact creation without a name is a 400', async () => {
  const res = await json('POST', '/api/contacts', { company: 'Nameless' });
  assert.equal(res.status, 400);
});

test('interaction endpoints validate contact and payload', async () => {
  const contact = await (await json('POST', '/api/contacts', { name: 'Interaction Test' })).json();

  const missing = await json('POST', '/api/contacts/nope/interactions', { summary: 'x' });
  assert.equal(missing.status, 404);

  const invalid = await json('POST', `/api/contacts/${contact.id}/interactions`, { channel: 'call' });
  assert.equal(invalid.status, 400);

  const ok = await json('POST', `/api/contacts/${contact.id}/interactions`, {
    summary: 'Sent the deck',
    channel: 'email',
    message: 'Subject: The deck\n\nHi — full text here.'
  });
  assert.equal(ok.status, 201);
  const interaction = await ok.json();
  assert.equal(interaction.message.startsWith('Subject:'), true);

  const gone = await json('DELETE', `/api/contacts/${contact.id}/interactions/${interaction.id}`);
  assert.equal(gone.status, 204);
});

test('export → import round-trip merges instead of duplicating', async () => {
  await json('POST', '/api/contacts', { name: 'Round Trip', email: 'rt@example.com' });
  const exported = await (await fetch(base + '/api/contacts/export')).json();
  assert.ok(Array.isArray(exported.contacts));

  const result = await (await json('POST', '/api/contacts/import', exported)).json();
  assert.equal(result.added, 0);
  assert.ok(result.merged >= 1);
});

test('import rejects files without a contacts array', async () => {
  const res = await json('POST', '/api/contacts/import', { foo: 1 });
  assert.equal(res.status, 400);
});

test('CSV export quotes fields and includes header', async () => {
  await json('POST', '/api/contacts', { name: 'Comma, Inc "Quotes"', company: 'CSV Co' });
  const text = await (await fetch(base + '/api/contacts/export.csv')).text();
  assert.match(text, /"Name","Role","Company"/);
  assert.match(text, /"Comma, Inc ""Quotes"""/);
});

test('settings round-trip and ignore unknown keys', async () => {
  const res = await json('PUT', '/api/settings', { signature: 'Cheers,\nT', hacker: 'field' });
  const settings = await res.json();
  assert.equal(settings.signature, 'Cheers,\nT');
  assert.equal(settings.hacker, undefined);
});

test('weekly stats count distinct engaged contacts', async () => {
  const before = await (await fetch(base + '/api/stats')).json();

  const a = await (await json('POST', '/api/contacts', { name: 'Stats A' })).json();
  const b = await (await json('POST', '/api/contacts', { name: 'Stats B' })).json();
  // two interactions with A (must count once) + one with B
  await json('POST', `/api/contacts/${a.id}/interactions`, { summary: 'call one' });
  await json('POST', `/api/contacts/${a.id}/interactions`, { summary: 'call two' });
  await json('POST', `/api/contacts/${b.id}/interactions`, { summary: 'intro email' });

  const after = await (await fetch(base + '/api/stats')).json();
  assert.equal(after.weeks[0].engaged, before.weeks[0].engaged + 2, 'A counts once, B counts once');
  assert.equal(after.weeks.length, 5);
  assert.ok(after.weeks[0].start <= after.today && after.today <= addDays(after.weeks[0].start, 6));
});

test('weekly goal is settable and clamped', async () => {
  const s = await (await json('PUT', '/api/settings', { weeklyGoal: 15 })).json();
  assert.equal(s.weeklyGoal, 15);
  const clamped = await (await json('PUT', '/api/settings', { weeklyGoal: -5 })).json();
  assert.equal(clamped.weeklyGoal, 0);
  const ignored = await (await json('PUT', '/api/settings', { weeklyGoal: 'lots' })).json();
  assert.equal(ignored.weeklyGoal, 0); // non-numeric leaves previous value
});

test('follow-up dates drive the due list', async () => {
  const c = await (await json('POST', '/api/contacts', { name: 'Followup Test' })).json();
  const today = new Date().toISOString().slice(0, 10);

  await json('PUT', `/api/contacts/${c.id}`, { nextFollowUp: addDays(today, -2) });
  let stats = await (await fetch(base + '/api/stats')).json();
  assert.ok(stats.dueFollowUps.some((d) => d.id === c.id), 'past date is due');

  await json('PUT', `/api/contacts/${c.id}`, { nextFollowUp: addDays(today, 3) });
  stats = await (await fetch(base + '/api/stats')).json();
  assert.ok(!stats.dueFollowUps.some((d) => d.id === c.id), 'future date is not due');
  assert.ok(stats.upcomingFollowUps.some((d) => d.id === c.id));

  await json('PUT', `/api/contacts/${c.id}`, { nextFollowUp: '' }); // clear
  stats = await (await fetch(base + '/api/stats')).json();
  assert.ok(!stats.upcomingFollowUps.some((d) => d.id === c.id));
});

test('invalid follow-up dates are rejected by sanitization', async () => {
  const c = await (await json('POST', '/api/contacts', { name: 'Bad Date', nextFollowUp: 'soonish' })).json();
  assert.equal(c.nextFollowUp, '');
});

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('generate: finish mode without a draft is a 400', async () => {
  const res = await json('POST', '/api/generate', { mode: 'finish', draft: '  ' });
  assert.equal(res.status, 400);
});

test('generate: refine mode requires message and instruction', async () => {
  const res = await json('POST', '/api/generate', { mode: 'refine', currentMessage: 'hi' });
  assert.equal(res.status, 400);
});
