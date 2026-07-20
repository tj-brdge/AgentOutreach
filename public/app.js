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

// Local-time YYYY-MM-DD — toISOString would use UTC and shift evening
// activity onto tomorrow's date (wrong day, sometimes wrong goal week).
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
let stats = null;

async function loadContacts() {
  contacts = await api.get('/api/contacts');
  renderContactSelects();
  renderContactList();
  await loadStats();
}

// ---------- weekly goal + follow-up stats ----------
async function loadStats() {
  stats = await api.get('/api/stats');
  const bar = $('#statsbar');

  if (stats.goal > 0) {
    const thisWeek = stats.weeks[0].engaged;
    const pct = Math.min(100, Math.round((thisWeek / stats.goal) * 100));
    $('#goal-text').innerHTML = `This week: <b>${thisWeek} / ${stats.goal}</b> contacts engaged`;
    $('#goal-fill').style.width = pct + '%';
    $('#goal-fill').classList.toggle('goal-met', thisWeek >= stats.goal);
    const past = stats.weeks.slice(1).map((w) => w.engaged).reverse();
    $('#weeks-history').textContent = past.length ? `previous weeks: ${past.join(' · ')}` : '';
    $('.goal-wrap').classList.remove('hidden');
  } else {
    $('.goal-wrap').classList.add('hidden');
  }

  const due = stats.dueFollowUps.length;
  $('#due-link').textContent = due ? `⏰ ${due} follow-up${due > 1 ? 's' : ''} due` : '';
  $('#due-link').classList.toggle('hidden', !due);
  bar.classList.toggle('hidden', stats.goal <= 0 && !due);

  renderDueSection();
}

$('#due-link').addEventListener('click', () => switchView('contacts'));

function switchView(view) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
}

function goToCompose(contactId, type) {
  switchView('compose');
  $('#compose-contact').value = contactId;
  $('#compose-contact').dispatchEvent(new Event('change'));
  if (type) $('#compose-type').value = type;
}

function renderDueSection() {
  const section = $('#due-section');
  if (!stats?.dueFollowUps.length) return section.classList.add('hidden');
  section.classList.remove('hidden');
  $('#due-items').innerHTML = stats.dueFollowUps
    .map((d) => {
      const overdueDays = Math.round((new Date(stats.today) - new Date(d.nextFollowUp)) / 86400000);
      const when = overdueDays === 0 ? 'today' : `${overdueDays}d overdue`;
      return `<div class="due-item" data-id="${d.id}">
        <span><b>${esc(d.name)}</b>${d.company ? ' · ' + esc(d.company) : ''} <span class="due-when ${overdueDays > 0 ? 'overdue' : ''}">${when}</span></span>
        <span class="due-actions">
          <button class="small" data-due-compose="${d.id}">✉ Follow up</button>
          <button class="small" data-got-reply="${d.id}" title="They answered — logs the reply and clears this follow-up">✓ Got a reply</button>
          <button class="small" data-park="${d.id}" title="No response after several touches — push out 90 days">⏸ Park</button>
        </span>
      </div>`;
    })
    .join('');
}

async function gotReply(contactId) {
  const gist = prompt('What did they say? (optional — helps future drafts)');
  if (gist === null) return; // cancelled
  await api.send('POST', `/api/contacts/${contactId}/interactions`, {
    channel: 'other',
    summary: gist.trim() ? `Received a reply: ${gist.trim()}` : 'Received a reply'
  });
  await api.send('PUT', `/api/contacts/${contactId}`, { nextFollowUp: '' });
  await loadContacts();
  toast('Reply logged and follow-up cleared — schedule the next touch when you know it');
}

async function parkContact(contactId) {
  const next = new Date();
  next.setDate(next.getDate() + 90);
  await api.send('POST', `/api/contacts/${contactId}/interactions`, {
    channel: 'other',
    summary: 'Parked after no response — revisit later'
  });
  await api.send('PUT', `/api/contacts/${contactId}`, { nextFollowUp: localDate(next) });
  await loadContacts();
  toast(`Parked — they'll resurface in the due list on ${localDate(next)}`);
}

document.addEventListener('click', (e) => {
  const d = e.target.dataset || {};
  if (d.dueCompose) goToCompose(d.dueCompose, 'follow_up');
  else if (d.gotReply) gotReply(d.gotReply);
  else if (d.park) parkContact(d.park);
});

async function scheduleFollowUp(contactId, dateStr, { silent } = {}) {
  const res = await api.send('PUT', `/api/contacts/${contactId}`, { nextFollowUp: dateStr });
  if (res.ok && !silent) toast(dateStr ? `Follow-up set for ${dateStr}` : 'Follow-up cleared');
  await loadContacts();
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

// ---------- draft history + mark as sent ----------
const draftHistory = []; // this session's completed compose drafts, newest last
let historyIndex = -1;

function pushDraftHistory(text) {
  if (!text || draftHistory[draftHistory.length - 1] === text) return;
  draftHistory.push(text);
  if (draftHistory.length > 10) draftHistory.shift();
  historyIndex = draftHistory.length - 1;
  $('#compose-prev').classList.toggle('hidden', draftHistory.length < 2);
}

$('#compose-prev').addEventListener('click', () => {
  if (!draftHistory.length) return;
  historyIndex = (historyIndex - 1 + draftHistory.length) % draftHistory.length;
  $('#compose-output').textContent = draftHistory[historyIndex];
  updateCharCount();
  toast(`Draft ${historyIndex + 1} of ${draftHistory.length} from this session`);
});

function channelToInteraction(channel) {
  return channel === 'email' ? 'email' : 'linkedin';
}

function sentSummary(text, channel) {
  const firstLine = text.split('\n').find((l) => l.trim()) || '';
  const label = channel === 'email' ? 'email' : channel.replace('linkedin_', 'LinkedIn ').replace('_', ' ');
  const gist = firstLine.startsWith('Subject:') ? firstLine : `"${firstLine.slice(0, 90)}${firstLine.length > 90 ? '…' : ''}"`;
  return `Sent ${label}: ${gist}`;
}

async function markAsSent(contactId, text, channel) {
  const res = await api.send('POST', `/api/contacts/${contactId}/interactions`, {
    channel: channelToInteraction(channel),
    summary: sentSummary(text, channel),
    message: text
  });
  if (!res.ok) return toast('Could not log the message', true);

  // Never leave a sent message without a scheduled next touch: if no future
  // follow-up exists, set one 4 days out (editable on the contact card).
  const contact = contacts.find((c) => c.id === contactId);
  const today = localDate();
  if (!contact?.nextFollowUp || contact.nextFollowUp <= today) {
    const next = new Date();
    next.setDate(next.getDate() + 4);
    await scheduleFollowUp(contactId, localDate(next), { silent: true });
    toast(`Logged — follow-up scheduled for ${localDate(next)} (change it on the contact card)`);
  } else {
    await loadContacts();
    toast('Logged — future drafts to this contact will build on it');
  }
}

$('#compose-sent').addEventListener('click', () => {
  const text = $('#compose-output').textContent;
  const contactId = $('#compose-contact').value;
  if (!contactId) return toast('Select a saved contact to log sent messages', true);
  markAsSent(contactId, text, lastComposeBody?.channel || $('#compose-channel').value);
});

$('#finish-sent').addEventListener('click', () => {
  const text = $('#finish-output').textContent;
  const contactId = $('#finish-contact').value;
  if (!contactId) return toast('Select a saved contact to log sent messages', true);
  markAsSent(contactId, text, lastFinishBody?.channel || $('#finish-channel').value);
});

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
      $('#compose-sent').classList.toggle('hidden', !text || !$('#compose-contact').value);
      pushDraftHistory(text);
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
      $('#finish-sent').classList.toggle('hidden', !text || !$('#finish-contact').value);
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
function lastTouched(c) {
  return c.interactions.reduce((max, i) => (i.date > max ? i.date : max), '');
}

function visibleContacts() {
  const q = ($('#contact-search').value || '').trim().toLowerCase();
  let result = contacts;
  if (q) {
    result = result.filter((c) =>
      [c.name, c.company, c.role, c.email, c.notes].some((f) => f && f.toLowerCase().includes(q))
    );
  }
  const sort = $('#contact-sort').value;
  result = [...result];
  if (sort === 'name') {
    result.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'followup') {
    // scheduled follow-ups first (soonest at top), unscheduled last
    result.sort((a, b) => (a.nextFollowUp || '9999') < (b.nextFollowUp || '9999') ? -1 : 1);
  } else if (sort === 'touched') {
    result.sort((a, b) => (lastTouched(a) > lastTouched(b) ? -1 : 1));
  }
  // 'recent' keeps stored order (newest first)
  return result;
}

$('#contact-search').addEventListener('input', renderContactList);
$('#contact-sort').addEventListener('change', renderContactList);

function renderContactList() {
  const list = $('#contact-list');
  if (!contacts.length) {
    list.innerHTML = '<p class="muted">No contacts yet. Add people you meet — every interaction you log makes future messages sharper.</p>';
    return;
  }
  const shown = visibleContacts();
  if (!shown.length) {
    list.innerHTML = '<p class="muted">No contacts match your search.</p>';
    return;
  }
  list.innerHTML = shown
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
        <input type="date" value="${localDate()}" />
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
        <button class="small" data-got-reply="${c.id}" title="They answered — logs the reply and clears any scheduled follow-up">✓ Got a reply</button>
        <span class="followup-ctl">
          <label>Next follow-up</label>
          <input type="date" data-followup value="${esc(c.nextFollowUp || '')}" />
        </span>
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

$('#contact-list').addEventListener('change', (e) => {
  if (!e.target.matches('[data-followup]')) return;
  const card = e.target.closest('.contact-card');
  scheduleFollowUp(card.dataset.id, e.target.value);
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
    const c = contacts.find((x) => x.id === id);
    goToCompose(id, c?.relationship === 'cold' ? 'cold' : 'warm');
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
  const text = await file.text();

  try {
    let res;
    if (file.name.toLowerCase().endsWith('.csv')) {
      res = await fetch('/api/contacts/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text
      });
    } else {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return toast('That file is not a valid JSON export', true);
      }
      res = await api.send('POST', '/api/contacts/import', parsed);
    }
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
  $('#s-goal').value = s.weeklyGoal ?? 10;
}

$('#s-save').addEventListener('click', async () => {
  await api.send('PUT', '/api/settings', {
    companyProfile: $('#s-company').value,
    valueProps: $('#s-valueprops').value,
    senderProfile: $('#s-sender').value,
    signature: $('#s-signature').value,
    weeklyGoal: Number($('#s-goal').value)
  });
  $('#s-status').textContent = ' Saved ✓';
  setTimeout(() => ($('#s-status').textContent = ''), 2500);
  await loadStats();
});

// ---------- init ----------
loadContacts();
loadSettings();
