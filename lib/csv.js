// Minimal RFC 4180 CSV parsing + mapping of spreadsheet exports to contacts.

// Parses CSV text into rows of string cells. Handles quoted fields,
// escaped quotes (""), commas and newlines inside quotes, CRLF, and a BOM.
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // drop fully-empty rows
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Header aliases, all compared lowercased with spaces/underscores/dashes removed
const HEADER_MAP = {
  name: 'name', fullname: 'name', contactname: 'name', contact: 'name',
  firstname: '_first', lastname: '_last',
  company: 'company', organization: 'company', organisation: 'company', employer: 'company', account: 'company',
  role: 'role', title: 'role', jobtitle: 'role', position: 'role',
  email: 'email', emailaddress: 'email', workemail: 'email', mail: 'email',
  linkedin: 'linkedin', linkedinurl: 'linkedin', linkedinprofile: 'linkedin', profileurl: 'linkedin',
  notes: 'notes', note: 'notes', comments: 'notes', description: 'notes',
  relationship: 'relationship', stage: 'relationship', status: 'relationship'
};

const RELATIONSHIP_ALIASES = {
  cold: 'cold', new: 'cold', prospect: 'cold', lead: 'cold',
  warm: 'warm', engaged: 'warm', inconversation: 'warm',
  existing: 'existing', client: 'existing', customer: 'existing', partner: 'existing', friend: 'existing'
};

// Converts CSV text into { contacts, error }. Column meanings are detected
// from the header row; unknown columns are ignored. A Name column (or
// First/Last name pair) is required.
export function csvToContacts(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { contacts: [], error: 'CSV needs a header row and at least one data row' };

  const normalize = (h) => h.toLowerCase().replace(/[\s_\-./]/g, '');
  const fields = rows[0].map((h) => HEADER_MAP[normalize(h)] || null);

  const hasName = fields.includes('name');
  const hasSplitName = fields.includes('_first') || fields.includes('_last');
  if (!hasName && !hasSplitName) {
    return { contacts: [], error: `No name column found. Recognized headers include: Name, First Name/Last Name, Company, Role/Title, Email, LinkedIn, Notes, Relationship. Got: ${rows[0].join(', ')}` };
  }

  const contacts = [];
  for (const row of rows.slice(1)) {
    const c = {};
    let first = '', last = '';
    row.forEach((cell, i) => {
      const field = fields[i];
      const value = cell.trim();
      if (!field || !value) return;
      if (field === '_first') first = value;
      else if (field === '_last') last = value;
      else if (field === 'relationship') {
        c.relationship = RELATIONSHIP_ALIASES[normalize(value)] || undefined;
      } else if (field === 'notes') {
        c.notes = c.notes ? `${c.notes}; ${value}` : value;
      } else if (!c[field]) {
        c[field] = value;
      }
    });
    if (!c.name && (first || last)) c.name = `${first} ${last}`.trim();
    if (c.name) contacts.push(c);
  }
  return { contacts };
}
