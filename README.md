# BRDGE Outreach

A personal outreach assistant for BRDGE Insights. It drafts emails and LinkedIn messages grounded in the interactions you've actually had with people, and it can finish emails you've started — for introductions, cold, and warm outreach.

## What it does

- **Compose** — pick a saved contact (or type one-off recipient details), choose a channel and outreach type, state your goal, and get a draft that uses your logged interaction history for personalization. Refine with one click ("shorter", "warmer", "more direct") or a custom instruction, and regenerate for a different take.
- **Finish a draft** — paste an email or message you started; it completes it in your voice, preserving what you already wrote.
- **Contacts** — a lightweight CRM: people, relationship stage (cold / warm / existing), notes, and a log of interactions ("met at the CFA event, she mentioned her team drowns in transcripts during earnings season"). Everything you log feeds future drafts.
- **Settings** — the BRDGE Insights company profile, value points, sender info, and signature that ground every message. Edit them anytime.

Channels supported: email, LinkedIn connection request (with a live 300-character counter), LinkedIn message, and LinkedIn InMail. Outreach types: cold, warm, follow-up, asking for an intro, and making an intro between two people.

## Setup

```bash
npm install
cp .env.example .env    # then put your ANTHROPIC_API_KEY in .env
npm start
```

Open http://localhost:3040.

Requires Node 18+ and an Anthropic API key (get one at https://platform.claude.com). Generation uses Claude Opus 4.8 by default; override with `OUTREACH_MODEL` in `.env`.

## Sharing your contact list with a teammate

Two ways, depending on how live you need it:

**1. Pass a file back and forth (simplest).** On the Contacts tab, click **Export (share file)** and send the downloaded JSON to your teammate. They click **Import** on their copy of the app. Imports *merge*: contacts are matched by email (or name + company), blank fields are filled in, and interaction histories are combined — nothing gets overwritten and re-importing the same file is harmless. **Export CSV** gives a spreadsheet-friendly version for anyone who just wants to read the list.

**Import also accepts spreadsheets.** Drop a `.csv` on the same Import button to bring in an existing contact list — the header row is mapped automatically (Name or First/Last Name required; Company/Organization, Role/Title, Email, LinkedIn, Notes, and Relationship/Stage are recognized in common variants). CSV imports merge by the same rules, so re-importing an updated spreadsheet is safe.

**2. Run one shared instance (live, same list for everyone).** All data lives on the server in `data/db.json`, so if you host the app somewhere you can both reach — a small VPS, Render, Railway, Fly.io, or an always-on machine on your network via Tailscale — you're automatically working off the same contacts, history, and settings in real time. Before exposing it beyond localhost, set `APP_PASSWORD` in `.env`; the app then requires that password (HTTP Basic auth) on every request. Each person still needs nothing installed — it's just a URL.

## Data safety

- Every save is atomic (write-to-temp + rename), so a crash can never truncate your database.
- Timestamped backups land in `data/backups/` on every startup and before every import (the last 10 are kept). To restore one, stop the server and copy it over `data/db.json`.
- If `data/db.json` is ever unreadable, it's preserved as `db.corrupt-<timestamp>.json` instead of being overwritten, and the app starts empty so you can restore from a backup.
- All input — including imported files — is validated and sanitized: field-length caps, type checks, and enum coercion. A malformed import file skips bad records instead of corrupting good ones.

Run the test suite with `npm test` (covers the merge/dedupe logic, sanitization, API endpoints, auth, and crash recovery).

## Weekly goals and follow-ups

Set a **weekly outreach goal** in Settings (distinct contacts engaged per week). The bar under the header tracks progress for the current week (Mon–Sun) and shows the last four weeks' counts. A contact counts as "engaged" when at least one interaction with them is logged that week — marking a draft as sent counts automatically.

Follow-up discipline is built in:

- Every contact can carry a **Next follow-up** date (set it on the contact card).
- When you **Mark as sent**, a follow-up is auto-scheduled 4 days out if none exists — a sent message never leaves the pipeline without a next action.
- Contacts whose date has arrived appear in the **Due for follow-up** list at the top of the Contacts tab (and as a badge in the header), each with a one-click **Follow up** button that opens Compose pre-set to follow-up mode.
- Following up and marking it sent reschedules the next touch automatically, so the loop never dangles.
- **✓ Got a reply** (due list or contact card) logs their response — with an optional gist that improves future drafts — and clears the scheduled follow-up so you don't chase people mid-conversation.
- **⏸ Park** implements the three-strikes rule: logs that the thread went quiet and pushes the follow-up out 90 days, so dead threads leave the due list without being deleted.

The Contacts tab has filter-as-you-type search and sorting by recently added, follow-up due, last touched, or name.

## Marking messages as sent

After generating a draft for a saved contact, click **✓ Mark as sent** — the full message is logged on that contact. Future drafts to the same person then *build on* what was already said instead of repeating it (the model sees the text of your last few sent messages). **◀ History** lets you flip back through earlier drafts from the current session, so a good draft is never lost to a regenerate.

## How it's built

- Node + Express server, no build step. Frontend is plain HTML/CSS/JS served from `public/`.
- Contacts, interactions, and settings live in `data/db.json` (created on first write, gitignored).
- Drafting streams token-by-token from the Anthropic Messages API (`@anthropic-ai/sdk`) to the browser over server-sent events.
- The system prompt (in `lib/prompts.js`) encodes channel constraints (e.g. the LinkedIn note character cap), outreach-type playbooks, banned sales clichés, and a strict no-fabrication rule: personalization only comes from details you've provided.
