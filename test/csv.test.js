import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, csvToContacts } from '../lib/csv.js';

test('parseCSV handles quoted fields, escaped quotes, and commas', () => {
  const rows = parseCSV('a,"b,with,commas","she said ""hi"""\r\nd,e,f\n');
  assert.deepEqual(rows, [
    ['a', 'b,with,commas', 'she said "hi"'],
    ['d', 'e', 'f']
  ]);
});

test('parseCSV handles newlines inside quotes and a BOM', () => {
  const rows = parseCSV('﻿name,notes\nAda,"line one\nline two"');
  assert.deepEqual(rows, [
    ['name', 'notes'],
    ['Ada', 'line one\nline two']
  ]);
});

test('parseCSV drops fully-empty rows', () => {
  const rows = parseCSV('a,b\n,\n\nc,d');
  assert.deepEqual(rows, [['a', 'b'], ['c', 'd']]);
});

test('csvToContacts maps common header variants', () => {
  const { contacts } = csvToContacts(
    'Full Name,Organization,Job Title,Work Email,LinkedIn URL,Comments,Stage\n' +
    'Sarah Chen,Meridian Capital,Director,sarah@meridian.com,https://li.example/sc,Met at panel,Warm\n'
  );
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0], {
    name: 'Sarah Chen',
    company: 'Meridian Capital',
    role: 'Director',
    email: 'sarah@meridian.com',
    linkedin: 'https://li.example/sc',
    notes: 'Met at panel',
    relationship: 'warm'
  });
});

test('csvToContacts combines First/Last name columns', () => {
  const { contacts } = csvToContacts('First Name,Last Name,Company\nAda,Lovelace,Analytical\nGrace,,Navy\n');
  assert.equal(contacts[0].name, 'Ada Lovelace');
  assert.equal(contacts[1].name, 'Grace');
});

test('csvToContacts skips rows without a name and ignores unknown columns', () => {
  const { contacts } = csvToContacts('Name,FavoriteColor\nAda,blue\n,red\n');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].favoritecolor, undefined);
});

test('csvToContacts errors clearly when no name column exists', () => {
  const { error } = csvToContacts('Company,Email\nAcme,x@acme.com\n');
  assert.match(error, /No name column/);
});

test('csvToContacts maps relationship aliases and leaves unknowns to the default', () => {
  const { contacts } = csvToContacts('Name,Status\nA,client\nB,lead\nC,whatever\n');
  assert.equal(contacts[0].relationship, 'existing');
  assert.equal(contacts[1].relationship, 'cold');
  assert.equal(contacts[2].relationship, undefined); // store default applies
});
