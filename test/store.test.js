import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OUTREACH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-store-'));
const { store, sanitizeContact, sanitizeInteraction } = await import('../lib/store.js');

test('createContact sanitizes fields and applies defaults', () => {
  const c = store.createContact({
    name: '  Ada Lovelace  ',
    company: 'Analytical Engines',
    relationship: 'not-a-real-value',
    notes: 'x'.repeat(10000)
  });
  assert.equal(c.name, 'Ada Lovelace');
  assert.equal(c.relationship, 'cold'); // invalid enum coerced
  assert.equal(c.notes.length, 4000); // capped
  assert.deepEqual(c.interactions, []);
});

test('createContact rejects a contact without a name', () => {
  assert.equal(store.createContact({ company: 'NoName Inc' }), null);
  assert.equal(store.createContact({ name: '   ' }), null);
  assert.equal(store.createContact('garbage'), null);
});

test('addInteraction requires a summary and coerces bad channel/date', () => {
  const c = store.createContact({ name: 'Grace Hopper' });
  assert.equal(store.addInteraction(c.id, { channel: 'meeting' }), null);
  const i = store.addInteraction(c.id, { summary: 'Talked compilers', channel: 'carrier-pigeon', date: 'yesterday' });
  assert.equal(i.channel, 'other');
  assert.match(i.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('interactions can carry the full sent message, capped in length', () => {
  const i = sanitizeInteraction({ summary: 'Sent email', message: 'y'.repeat(20000) });
  assert.equal(i.message.length, 8000);
});

test('import adds brand-new contacts with their history', () => {
  const before = store.listContacts().length;
  const result = store.importContacts([
    { name: 'New Person', company: 'Acme', interactions: [{ summary: 'Intro call', date: '2026-06-01', channel: 'call' }] }
  ]);
  assert.deepEqual(result, { added: 1, merged: 0, skipped: 0 });
  assert.equal(store.listContacts().length, before + 1);
  const added = store.listContacts().find((c) => c.name === 'New Person');
  assert.equal(added.interactions.length, 1);
});

test('import merges by email', () => {
  store.createContact({ name: 'Em Match', email: 'em@example.com', company: 'Old Co' });
  const result = store.importContacts([
    { name: 'Completely Different Name', email: 'EM@Example.com', role: 'CTO' }
  ]);
  assert.equal(result.merged, 1);
  const c = store.listContacts().find((x) => x.email === 'em@example.com');
  assert.equal(c.role, 'CTO'); // backfilled
  assert.equal(c.company, 'Old Co'); // not overwritten
});

test('import merges by name+company (case-insensitive) and backfills email', () => {
  store.createContact({ name: 'Sarah Chen', company: 'Meridian Capital' });
  const result = store.importContacts([
    { name: 'sarah chen', company: 'MERIDIAN CAPITAL', email: 'sarah@meridian.com' }
  ]);
  assert.equal(result.merged, 1);
  const matches = store.listContacts().filter((c) => c.name.toLowerCase() === 'sarah chen');
  assert.equal(matches.length, 1); // no duplicate created
  assert.equal(matches[0].email, 'sarah@meridian.com');
});

test('import unions interaction histories without duplicating', () => {
  const c = store.createContact({ name: 'Dedupe Test', company: 'DT Co' });
  store.addInteraction(c.id, { summary: 'Met at event', date: '2026-07-01', channel: 'event' });
  const result = store.importContacts([
    {
      name: 'Dedupe Test',
      company: 'DT Co',
      interactions: [
        { summary: 'Met at event', date: '2026-07-01', channel: 'event' }, // duplicate
        { summary: 'Sent follow-up', date: '2026-07-02', channel: 'email' } // new
      ]
    }
  ]);
  assert.equal(result.merged, 1);
  assert.equal(store.getContact(c.id).interactions.length, 2);
});

test('import survives garbage records without throwing', () => {
  const result = store.importContacts([
    null,
    42,
    'string',
    { company: 'nameless' },
    { name: 'Valid Amid Garbage', interactions: 'not-an-array' },
    { name: 'Bad Interactions', interactions: [null, 7, { noSummary: true }, { summary: 'kept' }] }
  ]);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 4);
  const bad = store.listContacts().find((c) => c.name === 'Bad Interactions');
  assert.equal(bad.interactions.length, 1);
  assert.equal(bad.interactions[0].summary, 'kept');
});

test('import of a non-array is a no-op', () => {
  assert.deepEqual(store.importContacts({ contacts: 'nope' }), { added: 0, merged: 0, skipped: 0 });
});

test('saves are atomic: db.json is always valid JSON after writes', () => {
  const dbPath = path.join(process.env.OUTREACH_DATA_DIR, 'db.json');
  JSON.parse(fs.readFileSync(dbPath, 'utf8')); // throws if corrupt
  assert.ok(!fs.existsSync(dbPath + '.tmp-' + process.pid), 'temp file cleaned up');
});

test('a backup is taken before every import', () => {
  const backupDir = path.join(process.env.OUTREACH_DATA_DIR, 'backups');
  const backups = fs.readdirSync(backupDir).filter((f) => f.includes('pre-import'));
  assert.ok(backups.length >= 1);
});

test('a corrupt db.json is preserved, not overwritten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-corrupt-'));
  fs.writeFileSync(path.join(dir, 'db.json'), '{"contacts": [TRUNCATED');
  process.env.OUTREACH_DATA_DIR = dir;
  // query string forces a fresh module instance that re-reads the env var
  const fresh = await import('../lib/store.js?corrupt-test');
  assert.equal(fresh.store.listContacts().length, 0); // started empty
  const rescued = fs.readdirSync(dir).filter((f) => f.startsWith('db.corrupt-'));
  assert.equal(rescued.length, 1); // original bytes preserved
  assert.match(fs.readFileSync(path.join(dir, rescued[0]), 'utf8'), /TRUNCATED/);
});

test('sanitizeContact caps field lengths', () => {
  const c = sanitizeContact({ name: 'n'.repeat(500), email: 'e'.repeat(1000) });
  assert.equal(c.name.length, 200);
  assert.equal(c.email.length, 320);
});
