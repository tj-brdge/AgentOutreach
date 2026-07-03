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

## How it's built

- Node + Express server, no build step. Frontend is plain HTML/CSS/JS served from `public/`.
- Contacts, interactions, and settings live in `data/db.json` (created on first write, gitignored).
- Drafting streams token-by-token from the Anthropic Messages API (`@anthropic-ai/sdk`) to the browser over server-sent events.
- The system prompt (in `lib/prompts.js`) encodes channel constraints (e.g. the LinkedIn note character cap), outreach-type playbooks, banned sales clichés, and a strict no-fabrication rule: personalization only comes from details you've provided.
