import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { store } from './lib/store.js';
import { csvToContacts } from './lib/csv.js';
import {
  buildSystemPrompt,
  buildComposePrompt,
  buildFinishPrompt,
  buildRefinePrompt
} from './lib/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = process.env.OUTREACH_MODEL || 'claude-opus-4-8';

// Health probe — registered before auth so hosting platforms can reach it.
app.get('/health', (req, res) => res.json({ ok: true }));

// Optional shared-password protection — set APP_PASSWORD in .env when
// hosting the app somewhere your team can reach.
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const decoded = scheme === 'Basic' ? Buffer.from(encoded || '', 'base64').toString() : '';
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    const expected = Buffer.from(process.env.APP_PASSWORD);
    const given = Buffer.from(pass);
    const ok = decoded && given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (ok) return next();
    res.set('WWW-Authenticate', 'Basic realm="BRDGE Outreach"').status(401).send('Authentication required');
  });
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Contacts ----------
app.get('/api/contacts', (req, res) => res.json(store.listContacts()));

// Export the full contact list (with interaction history) as a JSON file
// your partner can import, or as a CSV for spreadsheets.
app.get('/api/contacts/export', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="brdge-contacts-${stamp}.json"`);
  res.json({ exportedAt: new Date().toISOString(), contacts: store.listContacts() });
});

app.get('/api/contacts/export.csv', (req, res) => {
  const q = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ['Name', 'Role', 'Company', 'Relationship', 'Email', 'LinkedIn', 'Notes', 'Interactions'].map(q).join(',')
  ];
  for (const c of store.listContacts()) {
    const history = c.interactions.map((i) => `[${i.date}] (${i.channel}) ${i.summary}`).join(' | ');
    rows.push([c.name, c.role, c.company, c.relationship, c.email, c.linkedin, c.notes, history].map(q).join(','));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="brdge-contacts-${stamp}.csv"`);
  res.type('text/csv').send('\ufeff' + rows.join('\r\n')); // BOM so Excel reads UTF-8
});

app.post('/api/contacts/import', (req, res) => {
  // Accepts either a raw array or the { contacts: [...] } shape our export produces
  const list = Array.isArray(req.body) ? req.body : req.body?.contacts;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Expected a JSON export file with a contacts array' });
  res.json(store.importContacts(list));
});

// Import a spreadsheet: header row is mapped to contact fields
// (Name or First/Last Name required; Company, Role, Email, LinkedIn,
// Notes, Relationship recognized). Merges like the JSON import.
app.post('/api/contacts/import-csv', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) {
    return res.status(400).json({ error: 'Empty CSV file' });
  }
  const { contacts, error } = csvToContacts(req.body);
  if (error) return res.status(400).json({ error });
  res.json(store.importContacts(contacts));
});

app.post('/api/contacts', (req, res) => {
  const contact = store.createContact(req.body);
  if (!contact) return res.status(400).json({ error: 'A contact needs at least a name' });
  res.status(201).json(contact);
});

app.put('/api/contacts/:id', (req, res) => {
  const contact = store.updateContact(req.params.id, req.body);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  res.json(contact);
});

app.delete('/api/contacts/:id', (req, res) => {
  if (!store.deleteContact(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
  res.status(204).end();
});

app.post('/api/contacts/:id/interactions', (req, res) => {
  if (!store.getContact(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
  const interaction = store.addInteraction(req.params.id, req.body);
  if (!interaction) return res.status(400).json({ error: 'An interaction needs a summary' });
  res.status(201).json(interaction);
});

app.delete('/api/contacts/:id/interactions/:interactionId', (req, res) => {
  if (!store.deleteInteraction(req.params.id, req.params.interactionId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(204).end();
});

// ---------- Settings ----------
app.get('/api/settings', (req, res) => res.json(store.getSettings()));
app.put('/api/settings', (req, res) => res.json(store.updateSettings(req.body)));

// ---------- Stats (weekly goal progress + follow-ups) ----------
app.get('/api/stats', (req, res) => res.json(store.stats()));

// ---------- Generation (streams text back as SSE) ----------
app.post('/api/generate', async (req, res) => {
  const { mode, contactId, adhocContact, channel, outreachType, tone, goal, draft, extraContext, currentMessage, instruction } = req.body;

  // Saved contact wins; otherwise use ad-hoc details typed into the form.
  const contact = contactId ? store.getContact(contactId) : adhocContact || null;

  let userPrompt;
  if (mode === 'finish') {
    if (!draft?.trim()) return res.status(400).json({ error: 'No draft provided' });
    userPrompt = buildFinishPrompt({ contact, channel, tone, goal, draft, extraContext });
  } else if (mode === 'refine') {
    if (!currentMessage?.trim() || !instruction?.trim()) {
      return res.status(400).json({ error: 'refine mode needs currentMessage and instruction' });
    }
    userPrompt = buildRefinePrompt({ currentMessage, instruction, channel });
  } else {
    userPrompt = buildComposePrompt({ contact, channel, outreachType, goal, tone, extraContext });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let stream;
  // Stop paying for tokens nobody will read if the browser goes away mid-draft.
  // Must listen on the RESPONSE: req 'close' fires as soon as the request body
  // has been fully read (i.e. immediately), which would abort every draft.
  res.on('close', () => {
    if (!res.writableEnded) stream?.abort();
  });

  try {
    stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system: buildSystemPrompt(store.getSettings()),
      messages: [{ role: 'user', content: userPrompt }]
    });

    stream.on('text', (delta) => send('delta', { text: delta }));

    const finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason === 'refusal') {
      send('error', { message: 'The model declined this request. Try rephrasing the context or goal.' });
    } else {
      send('done', {
        usage: finalMessage.usage,
        stop_reason: finalMessage.stop_reason
      });
    }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return; // client disconnected
    const message =
      err instanceof Anthropic.AuthenticationError || /authentication/i.test(err.message)
        ? 'Invalid or missing ANTHROPIC_API_KEY. Set it in .env and restart the server.'
        : err instanceof Anthropic.RateLimitError
          ? 'Rate limited by the API — wait a moment and try again.'
          : err instanceof Anthropic.APIError
            ? `API error (${err.status}): ${err.message}`
            : `Error: ${err.message}`;
    send('error', { message });
  } finally {
    res.end();
  }
});

// Listen only when run directly, so tests can import the app.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3040;
  app.listen(PORT, () => {
    console.log(`BRDGE Outreach running at http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('⚠ ANTHROPIC_API_KEY is not set — generation will fail until you add it to .env');
    }
  });
}
