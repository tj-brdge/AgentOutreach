// Tiny JSON-file store. One file, atomic synchronous writes — plenty for a
// small team tool and avoids native dependencies like sqlite.
//
// Durability model:
// - Every save writes to a temp file then renames over db.json (atomic on
//   all platforms), so a crash mid-write can never truncate the database.
// - A timestamped backup is taken on startup and before every import
//   (data/backups/, last 10 kept).
// - If db.json is unreadable at startup it is preserved as
//   db.corrupt-<timestamp>.json rather than silently overwritten.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR =
  process.env.OUTREACH_DATA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_TO_KEEP = 10;

const LIMITS = {
  name: 200,
  role: 300,
  company: 300,
  email: 320,
  linkedin: 500,
  notes: 4000,
  summary: 2000,
  message: 8000,
  interactionsPerContact: 500,
  contactsPerImport: 5000
};

const RELATIONSHIPS = new Set(['cold', 'warm', 'existing']);
const CHANNELS = new Set(['meeting', 'call', 'email', 'linkedin', 'event', 'other']);

const DEFAULTS = {
  settings: {
    companyProfile: `BRDGE Insights provides AI-powered investment research for institutional investors. Our platform, Strēm, unifies an investment team's data — SEC filings, earnings transcripts, news and market developments, internal research notes and models, and coverage history — so analysts can uncover alpha faster and turn insights into defensible, high-conviction recommendations tied to their portfolio and active coverage.`,
    senderProfile: `Torrence, BRDGE Insights (torrence@brdgeinsights.com)`,
    signature: `Best,\nTorrence`,
    valueProps: `- Strēm anchors every insight, analysis, and rating in the names and themes the team is actively covering\n- Cuts research aggregation time so analysts spend time on judgment, not data wrangling\n- Keeps coverage history and evolving perspectives in one defensible record`,
    weeklyGoal: 10
  },
  contacts: []
};

// ---------- sanitization ----------

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function isoDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

export function sanitizeInteraction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const summary = str(raw.summary, LIMITS.summary);
  if (!summary) return null;
  const interaction = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
    date: isoDate(raw.date),
    channel: CHANNELS.has(raw.channel) ? raw.channel : 'other',
    summary
  };
  const message = str(raw.message, LIMITS.message);
  if (message) interaction.message = message;
  return interaction;
}

export function sanitizeContact(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, LIMITS.name);
  if (!name) return null;
  const interactions = (Array.isArray(raw.interactions) ? raw.interactions : [])
    .map(sanitizeInteraction)
    .filter(Boolean)
    .slice(0, LIMITS.interactionsPerContact);
  return {
    name,
    role: str(raw.role, LIMITS.role),
    company: str(raw.company, LIMITS.company),
    email: str(raw.email, LIMITS.email),
    linkedin: str(raw.linkedin, LIMITS.linkedin),
    relationship: RELATIONSHIPS.has(raw.relationship) ? raw.relationship : 'cold',
    notes: str(raw.notes, LIMITS.notes),
    nextFollowUp:
      typeof raw.nextFollowUp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.nextFollowUp)
        ? raw.nextFollowUp
        : '',
    interactions
  };
}

// Local-time YYYY-MM-DD (toISOString would shift the date near midnight)
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(d) {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

// ---------- persistence ----------

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function backup(label) {
  if (!fs.existsSync(DB_PATH)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `db-${stamp}-${label}.json`));
  const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}

function load() {
  if (!fs.existsSync(DB_PATH)) return structuredClone(DEFAULTS);
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      settings: { ...structuredClone(DEFAULTS.settings), ...(parsed.settings || {}) },
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : []
    };
  } catch (err) {
    // Never overwrite a file we couldn't read — preserve it for recovery.
    const rescue = path.join(DATA_DIR, `db.corrupt-${Date.now()}.json`);
    fs.copyFileSync(DB_PATH, rescue);
    console.error(`⚠ ${DB_PATH} is unreadable (${err.message}). Preserved a copy at ${rescue}; starting from an empty database. Restore from data/backups/ if needed.`);
    return structuredClone(DEFAULTS);
  }
}

const db = load();
backup('startup');

// ---------- store API ----------

export const store = {
  getSettings: () => db.settings,
  updateSettings(patch) {
    for (const key of ['companyProfile', 'senderProfile', 'signature', 'valueProps']) {
      if (typeof patch[key] === 'string') db.settings[key] = patch[key].slice(0, 20000);
    }
    const goal = Number(patch.weeklyGoal);
    if (Number.isFinite(goal)) db.settings.weeklyGoal = Math.max(0, Math.min(1000, Math.round(goal)));
    save(db);
    return db.settings;
  },

  // Weekly engagement stats: a contact counts as "engaged" in a week if at
  // least one interaction with them is dated in that week (Mon–Sun).
  stats({ weeks = 5 } = {}) {
    const today = localISO(new Date());
    const thisMonday = mondayOf(new Date());

    const weekWindows = [];
    for (let w = 0; w < weeks; w++) {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - 7 * w);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      weekWindows.push({ start: localISO(start), end: localISO(end), engagedIds: new Set() });
    }

    for (const c of db.contacts) {
      for (const i of c.interactions) {
        for (const w of weekWindows) {
          if (i.date >= w.start && i.date <= w.end) w.engagedIds.add(c.id);
        }
      }
    }

    const dueFollowUps = db.contacts
      .filter((c) => c.nextFollowUp && c.nextFollowUp <= today)
      .sort((a, b) => (a.nextFollowUp < b.nextFollowUp ? -1 : 1))
      .map((c) => ({ id: c.id, name: c.name, company: c.company, nextFollowUp: c.nextFollowUp }));

    const upcomingFollowUps = db.contacts
      .filter((c) => c.nextFollowUp && c.nextFollowUp > today)
      .sort((a, b) => (a.nextFollowUp < b.nextFollowUp ? -1 : 1))
      .map((c) => ({ id: c.id, name: c.name, company: c.company, nextFollowUp: c.nextFollowUp }));

    return {
      goal: db.settings.weeklyGoal ?? 0,
      today,
      weeks: weekWindows.map((w) => ({ start: w.start, end: w.end, engaged: w.engagedIds.size })),
      dueFollowUps,
      upcomingFollowUps
    };
  },

  listContacts: () => db.contacts,
  getContact: (id) => db.contacts.find((c) => c.id === id),

  createContact(data) {
    const clean = sanitizeContact(data);
    if (!clean) return null;
    const contact = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    db.contacts.unshift(contact);
    save(db);
    return contact;
  },

  updateContact(id, patch) {
    const contact = this.getContact(id);
    if (!contact) return null;
    const clean = sanitizeContact({ ...contact, ...patch });
    if (!clean) return null;
    const { interactions: _ints, ...fields } = clean;
    Object.assign(contact, fields);
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
    const interaction = sanitizeInteraction(data);
    if (!interaction) return null;
    contact.interactions.unshift(interaction);
    contact.interactions.length = Math.min(contact.interactions.length, LIMITS.interactionsPerContact);
    save(db);
    return interaction;
  },

  deleteInteraction(contactId, interactionId) {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    const i = contact.interactions.findIndex((x) => x.id === interactionId);
    if (i === -1) return false;
    contact.interactions.splice(i, 1);
    save(db);
    return true;
  },

  // Merge a list of contacts (from an export file). Matches on email when
  // present, otherwise name+company; fills blank fields and unions
  // interaction histories rather than overwriting. Every record is
  // sanitized up front, so a malformed file can't corrupt the store or
  // abort partway through.
  importContacts(list) {
    if (!Array.isArray(list)) return { added: 0, merged: 0, skipped: 0 };
    backup('pre-import');
    const norm = (s) => (s || '').trim().toLowerCase();

    let added = 0, merged = 0, skipped = 0;
    for (const raw of list.slice(0, LIMITS.contactsPerImport)) {
      const inc = sanitizeContact(raw);
      if (!inc) { skipped++; continue; }
      // Same email = same person; otherwise fall back to name + company so a
      // record missing its email still merges instead of duplicating.
      const existing = db.contacts.find(
        (c) =>
          (norm(c.email) && norm(c.email) === norm(inc.email)) ||
          (norm(c.name) === norm(inc.name) && norm(c.company) === norm(inc.company))
      );

      if (!existing) {
        db.contacts.unshift({
          id: crypto.randomUUID(),
          ...inc,
          interactions: inc.interactions.map((i) => ({ ...i, id: crypto.randomUUID() })),
          createdAt: new Date().toISOString()
        });
        added++;
        continue;
      }

      for (const field of ['role', 'company', 'email', 'linkedin', 'notes', 'relationship']) {
        if (!existing[field] && inc[field]) existing[field] = inc[field];
      }
      const seen = new Set(existing.interactions.map((i) => `${i.date}|${i.channel}|${i.summary}`));
      for (const i of inc.interactions) {
        if (!seen.has(`${i.date}|${i.channel}|${i.summary}`)) {
          existing.interactions.unshift({ ...i, id: crypto.randomUUID() });
        }
      }
      existing.interactions.sort((a, b) => (a.date < b.date ? 1 : -1));
      merged++;
    }
    skipped += Math.max(0, list.length - LIMITS.contactsPerImport);
    save(db);
    return { added, merged, skipped };
  }
};
