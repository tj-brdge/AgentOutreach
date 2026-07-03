import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { store } from './lib/store.js';
import {
  buildSystemPrompt,
  buildComposePrompt,
  buildFinishPrompt,
  buildRefinePrompt
} from './lib/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = process.env.OUTREACH_MODEL || 'claude-opus-4-8';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Contacts ----------
app.get('/api/contacts', (req, res) => res.json(store.listContacts()));

app.post('/api/contacts', (req, res) => res.status(201).json(store.createContact(req.body)));

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
  const interaction = store.addInteraction(req.params.id, req.body);
  if (!interaction) return res.status(404).json({ error: 'Contact not found' });
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

  try {
    const stream = client.messages.stream({
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

const PORT = process.env.PORT || 3040;
app.listen(PORT, () => {
  console.log(`BRDGE Outreach running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠ ANTHROPIC_API_KEY is not set — generation will fail until you add it to .env');
  }
});
