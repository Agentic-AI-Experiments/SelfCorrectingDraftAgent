// src/facts.js
//
// Claim extraction + unsupported-claim detection.
//
// The sensor's `no_unsupported_claims` dim needs to know which numbers,
// named entities, and tool names in the draft came from the user's
// keywords/facts vs. which ones the LLM invented.
//
// We extract "claims" from the draft (numbers + capitalized proper-noun-ish
// tokens that look like company/tool names) and diff against the user's
// input. Anything in the draft that isn't in the input is flagged.
//
// Heuristic-only by design (no NER model dependency). Good enough for
// catching fabricated metrics and made-up employers; not perfect.
//
// Contract:
//   extractFacts(input: string)            → { keywords, numbers, names, tools }
//   extractClaimsFromDraft(draft: string)  → [{ text, offset, kind }]
//   diff(facts, claims)                    → { enabled, keywords, numbers, names, tools, claims }
//     .claims = unsupported claims (in draft, not in input)

/**
 * Parse the user's input string into structured facts.
 * Input can be a free-text string or an array of bullets.
 */
export function extractFacts(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input || '');
  const lower = text.toLowerCase();

  // Numbers (including %, $, k, M suffixes)
  const numbers = [];
  const numRe = /\b(\d+(?:[.,]\d+)?)\s*(%|\$|k|m|mn|bn|x)?\b/gi;
  let m;
  while ((m = numRe.exec(text)) !== null) {
    // Skip phone-like sequences (5+ consecutive digits) and dates that are
    // clearly years (1900-2100 standalone) to reduce false positives.
    const raw = m[1].replace(/[.,]/g, '');
    if (/^\d{4,}$/.test(raw)) {
      // Year-like. Only include if not a year range.
      const n = parseInt(raw, 10);
      if (n >= 1900 && n <= 2100) continue;
    }
    numbers.push(m[0].trim());
  }

  // Capitalized multi-word proper-noun sequences (likely company / tool names).
  // Require at least one capitalized word and no all-caps acronyms >3 chars.
  const names = [];
  const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  while ((m = nameRe.exec(text)) !== null) {
    const phrase = m[1];
    // Filter common false positives (sentence starters, etc.)
    if (isLikelyName(phrase, text)) names.push(phrase);
  }

  // Known tool keywords (signal words that suggest tech tools).
  // If any of these appear in input, treat the exact phrase as a "tool" fact.
  const tools = [];
  const toolSignals = [
    'stripe', 'shopify', 'salesforce', 'hubspot', 'notion', 'slack',
    'figma', 'airtable', 'linear', 'jira', 'github', 'gitlab',
    'react', 'vue', 'angular', 'node', 'python', 'java', 'rust', 'go',
    'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'terraform',
    'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'kafka',
    'playwright', 'puppeteer', 'selenium', 'cypress', 'vitest', 'jest',
    'openai', 'anthropic', 'claude', 'gpt', 'ollama', 'huggingface',
    'resend', 'sendgrid', 'mailgun', 'twilio',
  ];
  for (const sig of toolSignals) {
    const re = new RegExp(`\\b${sig}\\b`, 'i');
    if (re.test(text)) tools.push(sig);
  }

  // Keywords = remaining meaningful tokens (very rough). We use this mainly
  // for the facts presence check; the sensor doesn't currently use this.
  const keywords = lower
    .split(/[^a-z0-9]+/i)
    .filter(w => w.length >= 3)
    .filter((w, i, arr) => arr.indexOf(w) === i);

  return { keywords, numbers, names, tools };
}

function isLikelyName(phrase, fullText) {
  // A phrase is a "likely name" if:
  //   - it has at least 2 capitalized words (more than just a sentence start), OR
  //   - it appears near a known org signal ("Inc", "Corp", "Ltd", "GmbH"), OR
  //   - it appears multiple times in the text
  const words = phrase.split(/\s+/);
  if (words.length >= 2) return true;
  // Single capitalized word: require org signal within next 5 words
  const re = new RegExp(`${escapeRe(phrase)}\\s+(?:Inc|Corp|Corporation|Ltd|LLC|GmbH|AG|SA|S\\.A)\\b`, 'i');
  if (re.test(fullText)) return true;
  // Or appears multiple times
  const occurrences = (fullText.match(new RegExp(`\\b${escapeRe(phrase)}\\b`, 'g')) || []).length;
  return occurrences >= 2;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract claims from a draft: numbers + proper-noun names + tool words.
 * Returns array of { text, offset, kind }.
 */
export function extractClaimsFromDraft(draft) {
  const claims = [];
  const text = String(draft || '');

  // Numbers
  const numRe = /\b(\d+(?:[.,]\d+)?)\s*(%|\$|k|m|mn|bn|x)?\b/gi;
  let m;
  while ((m = numRe.exec(text)) !== null) {
    const raw = m[1].replace(/[.,]/g, '');
    if (/^\d{4,}$/.test(raw)) {
      const n = parseInt(raw, 10);
      if (n >= 1900 && n <= 2100) continue;
    }
    claims.push({ text: m[0].trim(), offset: m.index, kind: 'number' });
  }

  // Multi-word proper nouns (likely names)
  const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  while ((m = nameRe.exec(text)) !== null) {
    if (isLikelyName(m[1], text)) {
      claims.push({ text: m[1], offset: m.index, kind: 'name' });
    }
  }

  // Tool keywords (case-insensitive match in draft)
  const toolSignals = [
    'stripe', 'shopify', 'salesforce', 'hubspot', 'notion', 'slack',
    'figma', 'airtable', 'linear', 'jira', 'github', 'gitlab',
    'react', 'vue', 'angular', 'node', 'python', 'java', 'rust', 'go',
    'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'terraform',
    'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'kafka',
    'playwright', 'puppeteer', 'selenium', 'cypress', 'vitest', 'jest',
    'openai', 'anthropic', 'claude', 'gpt', 'ollama', 'huggingface',
    'resend', 'sendgrid', 'mailgun', 'twilio',
  ];
  for (const sig of toolSignals) {
    const re = new RegExp(`\\b${sig}\\b`, 'gi');
    let tm;
    while ((tm = re.exec(text)) !== null) {
      claims.push({ text: tm[0], offset: tm.index, kind: 'tool' });
    }
  }

  return claims;
}

/**
 * Given parsed facts (from input) and claims (from draft), produce the diff
 * that the sensor's no_unsupported_claims dim consumes.
 *
 *   { enabled, keywords, numbers, names, tools, claims }
 *
 *   .claims = the UNSUPPORTED claims (in draft, NOT in input facts).
 */
export function diff(facts, claims) {
  if (!facts) return { enabled: false, claims: [] };

  const inputText = [
    ...(facts.keywords || []),
    ...(facts.numbers || []),
    ...(facts.names || []).map(n => n.toLowerCase()),
    ...(facts.tools || []),
  ].join(' ').toLowerCase();

  const unsupported = [];
  for (const c of claims) {
    const needle = c.text.toLowerCase();
    // Strip surrounding whitespace, punctuation
    const clean = needle.replace(/[^a-z0-9$.%]/g, '');
    if (!inputText.includes(clean) && !inputText.includes(needle)) {
      unsupported.push(c);
    }
  }

  return {
    enabled: true,
    keywords: facts.keywords || [],
    numbers: facts.numbers || [],
    names: facts.names || [],
    tools: facts.tools || [],
    claims: unsupported,
  };
}
