// Regression test for the drafting flow: /api/generate must stream the whole
// message. Uses a mock Anthropic API (via ANTHROPIC_BASE_URL) that emits
// deltas with small delays — which is exactly what exposed the bug where the
// stream was aborted the moment the request body finished arriving.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- mock Anthropic Messages API ----
const CHUNKS = ['Subject: Hello', '\n\nHi Sarah,', ' great to', ' meet you.'];
const mockApi = http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-opus-4-8',
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 }
    }
  });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (const text of CHUNKS) {
    await sleep(40); // give a wrongly-wired abort handler time to fire
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  }
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
});
await new Promise((r) => mockApi.listen(0, r));

process.env.OUTREACH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-gen-'));
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy';
process.env.ANTHROPIC_BASE_URL = `http://localhost:${mockApi.address().port}`;
delete process.env.APP_PASSWORD;

const { app } = await import('../server.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
after(() => { server.close(); mockApi.close(); });

function parseSSE(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

test('generate streams the complete draft and a done event', async () => {
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'compose', channel: 'email', outreachType: 'cold', tone: 'professional', goal: 'test' })
  });
  assert.equal(res.status, 200);
  const events = parseSSE(await res.text());

  const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
  assert.equal(text, CHUNKS.join(''), 'full draft must arrive — a premature abort truncates it');

  const done = events.find((e) => e.event === 'done');
  assert.ok(done, 'stream must finish with a done event');
  assert.equal(done.data.stop_reason, 'end_turn');

  const error = events.find((e) => e.event === 'error');
  assert.equal(error, undefined, `no error event expected, got: ${error && JSON.stringify(error.data)}`);
});

test('refine mode also completes', async () => {
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'refine', currentMessage: 'Hi there', instruction: 'shorter', channel: 'email' })
  });
  const events = parseSSE(await res.text());
  assert.ok(events.some((e) => e.event === 'done'));
});
