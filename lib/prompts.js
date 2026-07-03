const CHANNEL_GUIDES = {
  email: `Channel: EMAIL.
- Include a subject line on the first line, formatted exactly as "Subject: ..." followed by a blank line, then the body.
- Cold outreach: under 120 words in the body. Warm/intro: under 170 words.
- One clear call to action, low-friction (e.g. a specific 20-minute window, or a simple yes/no question).
- No bullet-point feature dumps in cold emails; one concrete, relevant hook beats three generic ones.`,

  linkedin_connection: `Channel: LINKEDIN CONNECTION REQUEST NOTE.
- HARD LIMIT: 280 characters total (LinkedIn caps notes at 300; leave margin). Count carefully.
- No subject line, no signature, no greeting-line fluff.
- One sentence of genuine context (where you crossed paths or why them specifically), one soft reason to connect. Never pitch in the note.`,

  linkedin_message: `Channel: LINKEDIN DIRECT MESSAGE (already connected).
- No subject line. Keep it under 90 words, conversational, mobile-readable.
- Short paragraphs of 1-2 sentences. No formal letter structure, no signature block — just a first-name sign-off if any.`,

  linkedin_inmail: `Channel: LINKEDIN INMAIL.
- Include a short subject line (under 45 characters) on the first line as "Subject: ...", then a blank line, then the body.
- Body under 120 words. InMail response rates drop sharply past that.
- Personal hook first, value second, one specific ask.`
};

const TYPE_GUIDES = {
  cold: `Outreach type: COLD. The recipient does not know the sender. The first line must earn the read — reference something specific and true about them (their role, company, a recent event, a shared context). Never open with "I hope this finds you well" or an introduction of the sender. Make the relevance to THEM obvious within two sentences.`,
  warm: `Outreach type: WARM. There is prior contact — lean on it. Reference the most relevant prior interaction naturally in the first line or two (not "as per our conversation"). Pick up the thread as a human would, then move it forward with one clear next step.`,
  intro_request: `Outreach type: ASKING FOR AN INTRODUCTION. The sender is asking the recipient to introduce them to a third party. Make it effortless: say who, why the connection is mutually relevant, and offer a short forwardable blurb. Give the recipient an easy out ("no pressure if it's not a fit").`,
  make_intro: `Outreach type: MAKING AN INTRODUCTION between two people. Address both parties, give each a one-to-two sentence credibility line, state why they should meet, and hand off ("I'll let you two take it from here"). Keep it tight and warm.`,
  follow_up: `Outreach type: FOLLOW-UP. There was a previous touchpoint with no response or an open loop. Add new value or a new angle — never "just bumping this". Two to four sentences max. Make replying easier than the last message did.`
};

const TONE_GUIDES = {
  professional: 'Tone: professional and polished, but human — no corporate stiffness.',
  friendly: 'Tone: warm and friendly, like writing to someone you genuinely like talking to.',
  direct: 'Tone: direct and brief. Respect their time. No warm-up sentences.',
  casual: 'Tone: casual and conversational, contractions welcome, light but competent.'
};

export function buildSystemPrompt(settings) {
  return `You are an expert outreach writer for BRDGE Insights. You write emails and LinkedIn messages that get replies: specific, human, brief, and free of sales clichés.

ABOUT THE COMPANY (BRDGE Insights):
${settings.companyProfile}

KEY VALUE POINTS (use at most ONE per message, only when relevant to the recipient):
${settings.valueProps}

SENDER:
${settings.senderProfile}

DEFAULT EMAIL SIGNATURE (emails only — adapt the sign-off to the requested tone if needed):
${settings.signature}

HARD RULES:
- Output ONLY the message itself. No preamble, no explanations, no options, no markdown formatting, no quotation marks around the message.
- Never fabricate facts about the recipient, their company, or shared history. Only use details provided in the request. If context is thin, write a strong message with what exists rather than inventing specifics.
- Never use these phrases or their close variants: "I hope this email finds you well", "I wanted to reach out", "quick question", "touch base", "circle back", "synergy", "revolutionize", "game-changer", "I know you're busy".
- Write like one smart person writing to another. Short sentences. No filler.
- Personalization must come from the provided interaction history and contact details — the more specific, the better.`;
}

function contactBlock(contact) {
  if (!contact) return 'RECIPIENT: (details provided in the request below)';
  const lines = [
    `RECIPIENT: ${contact.name}`,
    contact.role && `Role: ${contact.role}`,
    contact.company && `Company: ${contact.company}`,
    contact.relationship && `Relationship: ${contact.relationship}`,
    contact.notes && `Notes about them: ${contact.notes}`
  ].filter(Boolean);

  if (contact.interactions?.length) {
    lines.push('', 'INTERACTION HISTORY (most recent first):');
    for (const i of contact.interactions) {
      lines.push(`- [${i.date}] (${i.channel}) ${i.summary}`);
    }
  } else {
    lines.push('', 'INTERACTION HISTORY: none recorded.');
  }
  return lines.join('\n');
}

export function buildComposePrompt({ contact, channel, outreachType, goal, tone, extraContext }) {
  return [
    contactBlock(contact),
    '',
    CHANNEL_GUIDES[channel] || CHANNEL_GUIDES.email,
    '',
    TYPE_GUIDES[outreachType] || TYPE_GUIDES.cold,
    '',
    TONE_GUIDES[tone] || TONE_GUIDES.professional,
    '',
    goal ? `GOAL OF THIS MESSAGE: ${goal}` : 'GOAL OF THIS MESSAGE: start a conversation.',
    extraContext ? `\nADDITIONAL CONTEXT FROM THE SENDER:\n${extraContext}` : '',
    '',
    'Write the message now.'
  ].join('\n');
}

export function buildFinishPrompt({ contact, channel, tone, goal, draft, extraContext }) {
  return [
    contactBlock(contact),
    '',
    CHANNEL_GUIDES[channel] || CHANNEL_GUIDES.email,
    '',
    TONE_GUIDES[tone] || TONE_GUIDES.professional,
    '',
    goal ? `GOAL OF THIS MESSAGE: ${goal}` : '',
    extraContext ? `ADDITIONAL CONTEXT FROM THE SENDER:\n${extraContext}\n` : '',
    'The sender started writing this message but did not finish it:',
    '---DRAFT START---',
    draft,
    '---DRAFT END---',
    '',
    `Complete the message. Keep the sender's existing wording and voice as intact as possible — extend and finish it rather than rewriting it. Fix only clear typos or grammatical slips in the existing text. Match the style of what they already wrote, even where it differs from your usual style. Output the FULL completed message (their part plus yours, seamlessly joined).`
  ].join('\n');
}

export function buildRefinePrompt({ currentMessage, instruction, channel }) {
  return [
    CHANNEL_GUIDES[channel] || CHANNEL_GUIDES.email,
    '',
    'Here is the current draft of the message:',
    '---DRAFT START---',
    currentMessage,
    '---DRAFT END---',
    '',
    `Revise it according to this instruction: ${instruction}`,
    '',
    'Output only the full revised message.'
  ].join('\n');
}
