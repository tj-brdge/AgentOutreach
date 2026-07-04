// Tiny JSON-file store. One file, synchronous writes — plenty for a
// single-user tool and avoids native dependencies like sqlite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  settings: {
    companyProfile: `BRDGE Insights provides AI-powered investment research for institutional investors. Our platform, Strēm, unifies an investment team's data — SEC filings, earnings transcripts, news and market developments, internal research notes and models, and coverage history — so analysts can uncover alpha faster and turn insights into defensible, high-conviction recommendations tied to their portfolio and active coverage.`,
    senderProfile: `Torrence, BRDGE Insights (torrence@brdgeinsights.com)`,
    signature: `Best,\nTorrence`,
    valueProps: `- Strēm anchors every insight, analysis, and rating in the names and themes the team is actively covering\n- Cuts research aggregation time so analysts spend time on judgment, not data wrangling\n- Keeps coverage history and evolving perspectives in one defensible record`
  },
  contacts: []
};

function load() {
  try {
    return { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const db = load();

export const store = {
  getSettings: () => db.settings,
  updateSettings(patch) {
    Object.assign(db.settings, patch);
    save(db);
    return db.settings;
  },

  listContacts: () => db.contacts,
  getContact: (id) => db.contacts.find((c) => c.id === id),

  createContact(data) {
    const contact = {
      id: crypto.randomUUID(),
      name: data.name || 'Unnamed',
      company: data.company || '',
      role: data.role || '',
      email: data.email || '',
      linkedin: data.linkedin || '',
      relationship: data.relationship || 'cold', // cold | warm | existing
      notes: data.notes || '',
      interactions: [],
      createdAt: new Date().toISOString()
    };
    db.contacts.unshift(contact);
    save(db);
    return contact;
  },

  updateContact(id, patch) {
    const contact = this.getContact(id);
    if (!contact) return null;
    const { id: _id, interactions: _ints, createdAt: _c, ...safe } = patch;
    Object.assign(contact, safe);
    save(db);
    return contact;
  },

  deleteContact(id) {
    const i = db.contacts.findIndex((c) => c.id === id);
    if (i === -1) return false;
    db.contacts.splice(i, 1);
    save(db);
    return true;
  },

  addInteraction(contactId, data) {
    const contact = this.getContact(contactId);
    if (!contact) return null;
    const interaction = {
      id: crypto.randomUUID(),
      date: data.date || new Date().toISOString().slice(0, 10),
      channel: data.channel || 'other', // meeting | call | email | linkedin | event | other
      summary: data.summary || ''
    };
    contact.interactions.unshift(interaction);
    save(db);
    return interaction;
  },

  // Merge a list of contacts (from an export file). Matches on email when
  // present, otherwise name+company; fills blank fields and unions
  // interaction histories rather than overwriting.
  importContacts(list) {
    if (!Array.isArray(list)) return { added: 0, merged: 0, skipped: 0 };
    const norm = (s) => (s || '').trim().toLowerCase();

    let added = 0, merged = 0, skipped = 0;
    for (const inc of list) {
      if (!inc || !inc.name?.trim()) { skipped++; continue; }
      // Same email = same person; otherwise fall back to name + company so a
      // record missing its email still merges instead of duplicating.
      const existing = db.contacts.find(
        (c) =>
          (norm(c.email) && norm(c.email) === norm(inc.email)) ||
          (norm(c.name) === norm(inc.name) && norm(c.company) === norm(inc.company))
      );
      if (!existing) {
        const contact = this.createContact(inc);
        for (const i of inc.interactions || []) {
          if (i?.summary) this.addInteraction(contact.id, i);
        }
        added++;
        continue;
      }
      for (const field of ['role', 'company', 'email', 'linkedin', 'notes', 'relationship']) {
        if (!existing[field] && inc[field]) existing[field] = inc[field];
      }
      const seen = new Set(existing.interactions.map((i) => `${i.date}|${i.channel}|${i.summary}`));
      for (const i of inc.interactions || []) {
        if (i?.summary && !seen.has(`${i.date}|${i.channel}|${i.summary}`)) {
          this.addInteraction(existing.id, i);
        }
      }
      merged++;
    }
    save(db);
    return { added, merged, skipped };
  },

  deleteInteraction(contactId, interactionId) {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    const i = contact.interactions.findIndex((x) => x.id === interactionId);
    if (i === -1) return false;
    contact.interactions.splice(i, 1);
    save(db);
    return true;
  }
};
