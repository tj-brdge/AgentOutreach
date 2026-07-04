// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const api = {
  get: (url) => fetch(url).then((r) => r.json()),
  send: (method, url, body) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
};

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

// ---------- tabs ----------
$$('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${btn.dataset.view}`));
  })
);

// ---------- state ----------
let contacts = [];

async function loadContacts() {
  contacts = await api.get('/api/contacts');
  renderContactSelects();
  renderContactList();
}

// ---------- contact selects (compose + finish) ----------
function renderContactSelects() {
  const options = contacts
    .map((c) => `<option value="${c.id}">${esc(c.name)}${c.company ? ' — ' + esc(c.company) : ''}</option>`)
    .join('');
  $('#compose-contact').innerHTML =
    `<option value="">✏️ One-off recipient (type details below)</option>` + options;
  $('#finish-contact').innerHTML = `<option value="">No saved contact</option>` + options;
}

$('#compose-contact').addEventListener('change', () => {
  const id = $('#compose-contact').value;
  $('#adhoc-fields').classList.toggle('hidden', !!id);
  const historyEl = $('#contact-history');
  const contact = contacts.find((c) => c.id === id);
  if (contact && contact.interactions.length) {
    historyEl.innerHTML =
      `<div class="h-item"><b>History with ${esc(contact.name)}</b> (used for personalization):</div>` +
      contact.interactions
        .map((i) => `<div class="h-item">• <b>${esc(i.date)}</b> (${esc(i.channel)}) ${esc(i.summary)}</div>`)
        .join('');
    historyEl.classList.remove('hidden');
  } else {
    historyEl.classList.add('hidden');
  }
});

// ---------- generation (SSE over fetch) ----------
async function generate(body, outputEl, { onDone } = {}) {
  outputEl.textContent = '';
  outputEl.classList.add('streaming');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // parse complete SSE events from the buffer
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const eventMatch = raw.match(/^event: (.+)$/m);
        const dataMatch = raw.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const event = eventMatch[1];
        const data = JSON.parse(dataMatch[1]);

        if (event === 'delta') {
          outputEl.textContent += data.text;
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      }
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    outputEl.classList.remove('streaming');
    onDone?.(outputEl.textContent);
  }
}

// ---------- compose ----------
function composeRequestBody() {
  const contactId = $('#compose-contact').value || null;
  const body = {
    mode: 'compose',
    contactId,
    channel: $('#compose-channel').value,
    outreachType: $('#compose-type').value,
    tone: $('#compose-tone').value,
    goal: $('#compose-goal').value.trim(),
    extraContext: $('#compose-context').value.trim()
  };
  if (!contactId) {
    body.adhocContact = {
      name: $('#adhoc-name').value.trim() || 'the recipient',
      role: $('#adhoc-role').value.trim(),
      company: $('#adhoc-company').value.trim(),
      notes: $('#adhoc-context').value.trim(),
      interactions: []
    };
  }
  return body;
}

function updateCharCount() {
  const el = $('#compose-charcount');
  const text = $('#compose-output').textContent;
  if (!text || $('#compose-channel').value !== 'linkedin_connection') {
    el.textContent = '';
    el.classList.remove('over');
    return;
  }
  el.textContent = `${text.length} / 300 characters (LinkedIn connection note limit)`;
  el.classList.toggle('over', text.length > 300);
}

async function runCompose(body) {
  const btn = $('#compose-generate');
  btn.disabled = true;
  btn.textContent = 'Writing…';
  await generate(body, $('#compose-output'), {
    onDone: (text) => {
      btn.disabled = false;
      btn.textContent = 'Generate message';
      $('#compose-actions').classList.toggle('hidden', !text);
      $('#compose-refine-row').classList.toggle('hidden', !text);
      updateCharCount();
    }
  });
}

let lastComposeBody = null;

$('#compose-generate').addEventListener('click', () => {
  lastComposeBody = composeRequestBody();
  runCompose(lastComposeBody);
});

$('#compose-regenerate').addEventListener('click', () => {
  if (lastComposeBody) runCompose(lastComposeBody);
});

function refineCompose(instruction) {
  const currentMessage = $('#compose-output').textContent;
  if (!currentMessage || !instruction) return;
  runCompose({
    mode: 'refine',
    currentMessage,
    instruction,
    channel: (lastComposeBody?.channel) || $('#compose-channel').value
  });
}

$$('#compose-actions [data-refine]').forEach((btn) =>
  btn.addEventListener('click', () => refineCompose(btn.dataset.refine))
);

$('#compose-refine-btn').addEventListener('click', () => {
  refineCompose($('#compose-refine-input').value.trim());
  $('#compose-refine-input').value = '';
});
$('#compose-refine-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#compose-refine-btn').click();
});

$('#compose-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#compose-output').textContent);
  toast('Copied to clipboard');
});

// ---------- finish ----------
let lastFinishBody = null;

async function runFinish(body) {
  const btn = $('#finish-generate');
  btn.disabled = true;
  btn.textContent = 'Completing…';
  await generate(body, $('#finish-output'), {
    onDone: (text) => {
      btn.disabled = false;
      btn.textContent = 'Complete my draft';
      $('#finish-actions').classList.toggle('hidden', !text);
    }
  });
}

$('#finish-generate').addEventListener('click', () => {
  const draft = $('#finish-draft').value.trim();
  if (!draft) return toast('Paste your unfinished draft first', true);
  lastFinishBody = {
    mode: 'finish',
    draft,
    contactId: $('#finish-contact').value || null,
    channel: $('#finish-channel').value,
    tone: $('#finish-tone').value,
    goal: $('#finish-goal').value.trim()
  };
  runFinish(lastFinishBody);
});

$('#finish-regenerate').addEventListener('click', () => {
  if (lastFinishBody) runFinish(lastFinishBody);
});

$('#finish-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#finish-output').textContent);
  toast('Copied to clipboard');
});

// ---------- contacts ----------
function renderContactList() {
  const list = $('#contact-list');
  if (!contacts.length) {
    list.innerHTML = '<p class="muted">No contacts yet. Add people you meet — every interaction you log makes future messages sharper.</p>';
    return;
  }
  list.innerHTML = contacts
    .map(
      (c) => `
    <div class="contact-card" data-id="${c.id}">
      <div class="cc-top">
        <span class="cc-name">${esc(c.name)}</span>
        <span class="badge ${esc(c.relationship)}">${esc(c.relationship)}</span>
      </div>
      <div class="cc-meta">${esc([c.role, c.company].filter(Boolean).join(' · '))}${c.email ? ' · ' + esc(c.email) : ''}</div>
      ${c.notes ? `<div class="cc-notes">${esc(c.notes)}</div>` : ''}
      ${
        c.interactions.length
          ? `<div class="cc-interactions">${c.interactions
              .map(
                (i) => `<div class="cc-interaction"><span><b>${esc(i.date)}</b> (${esc(i.channel)}) ${esc(i.summary)}</span>
                 <button class="del" data-del-interaction="${i.id}" title="Delete">✕</button></div>`
              )
              .join('')}</div>`
          : ''
      }
      <div class="log-form">
        <input type="date" value="${new Date().toISOString().slice(0, 10)}" />
        <select>
          <option value="meeting">Meeting</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="linkedin">LinkedIn</option>
          <option value="event">Event</option>
          <option value="other">Other</option>
        </select>
        <input type="text" placeholder="What happened? e.g. discussed transcript workflow pain" />
        <button class="small" data-log>Log</button>
      </div>
      <div class="cc-actions">
        <button class="small" data-compose>✉ Compose to ${esc(c.name.split(' ')[0])}</button>
        <button class="small" data-delete>Delete contact</button>
      </div>
    </div>`
    )
    .join('');
}

$('#c-add').addEventListener('click', async () => {
  const name = $('#c-name').value.trim();
  if (!name) return toast('Name is required', true);
  await api.send('POST', '/api/contacts', {
    name,
    role: $('#c-role').value.trim(),
    company: $('#c-company').value.trim(),
    relationship: $('#c-relationship').value,
    email: $('#c-email').value.trim(),
    linkedin: $('#c-linkedin').value.trim(),
    notes: $('#c-notes').value.trim()
  });
  ['#c-name', '#c-role', '#c-company', '#c-email', '#c-linkedin', '#c-notes'].forEach((s) => ($(s).value = ''));
  await loadContacts();
  toast('Contact added');
});

$('#contact-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.contact-card');
  if (!card) return;
  const id = card.dataset.id;

  if (e.target.matches('[data-delete]')) {
    if (!confirm('Delete this contact and their interaction history?')) return;
    await api.send('DELETE', `/api/contacts/${id}`);
    await loadContacts();
    toast('Contact deleted');
  } else if (e.target.matches('[data-log]')) {
    const summary = card.querySelector('.log-form input[type="text"]').value.trim();
    if (!summary) return toast('Describe the interaction first', true);
    await api.send('POST', `/api/contacts/${id}/interactions`, {
      date: card.querySelector('.log-form input[type="date"]').value,
      channel: card.querySelector('.log-form select').value,
      summary
    });
    await loadContacts();
    toast('Interaction logged');
  } else if (e.target.matches('[data-del-interaction]')) {
    await api.send('DELETE', `/api/contacts/${id}/interactions/${e.target.dataset.delInteraction}`);
    await loadContacts();
  } else if (e.target.matches('[data-compose]')) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === 'compose'));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-compose'));
    $('#compose-contact').value = id;
    $('#compose-contact').dispatchEvent(new Event('change'));
    const c = contacts.find((x) => x.id === id);
    $('#compose-type').value = c?.relationship === 'cold' ? 'cold' : 'warm';
  }
});

// ---------- export / import ----------
$('#export-json').addEventListener('click', () => {
  window.location.href = '/api/contacts/export';
});

$('#export-csv').addEventListener('click', () => {
  window.location.href = '/api/contacts/export.csv';
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast('That file is not a valid JSON export', true);
  }
  try {
    const res = await api.send('POST', '/api/contacts/import', parsed);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Import failed');
    }
    const { added, merged, skipped } = await res.json();
    await loadContacts();
    toast(`Imported: ${added} new, ${merged} merged${skipped ? `, ${skipped} skipped` : ''}`);
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- settings ----------
async function loadSettings() {
  const s = await api.get('/api/settings');
  $('#s-company').value = s.companyProfile || '';
  $('#s-valueprops').value = s.valueProps || '';
  $('#s-sender').value = s.senderProfile || '';
  $('#s-signature').value = s.signature || '';
}

$('#s-save').addEventListener('click', async () => {
  await api.send('PUT', '/api/settings', {
    companyProfile: $('#s-company').value,
    valueProps: $('#s-valueprops').value,
    senderProfile: $('#s-sender').value,
    signature: $('#s-signature').value
  });
  $('#s-status').textContent = ' Saved ✓';
  setTimeout(() => ($('#s-status').textContent = ''), 2500);
});

// ---------- init ----------
loadContacts();
loadSettings();
