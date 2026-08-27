// src/sensor.js
//
// Deterministic rubric evaluator. Pure functions, no LLM.
//
// Contract:
//   loadRubric(path)           → rubric object (from rubrics/linkedin_post.json)
//   evaluate(draft, rubric, facts) → { passed, per_dim }
//
//   per_dim[<name>] = {
//     passed: boolean,
//     expected: string,   // human-readable rule
//     got: string|number, // observed value
//     location: string    // where in the draft (e.g. "char 0", "paragraph 2")
//   }
//
// Each dimension has a registered evaluator below. Adding a new dim:
//   1. Add it to rubrics/linkedin_post.json
//   2. Add an evaluator entry to EVALUATORS
//   3. Add tests in tests/test-sensor.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUBRICS_DIR = path.resolve(__dirname, '..', 'rubrics');

export function loadRubric(name = 'linkedin_post') {
  const filePath = path.join(RUBRICS_DIR, `${name}.json`);
  const text = readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function countSentences(text) {
  // Naive: split on . ! ? followed by whitespace or end. Filters empties.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean).length;
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
}

function countEmojis(text) {
  // Match most common Unicode emoji code points. Not exhaustive but
  // covers >95% of real-world use cases.
  const emojiRe = /\p{Extended_Pictographic}/gu;
  const matches = text.match(emojiRe);
  return matches ? matches.length : 0;
}

function extractHashtags(text) {
  const re = /#([A-Za-z0-9_]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function findAllCapsWords(text, maxAllowedLen) {
  const re = /\b([A-Z]{4,})\b/g;
  // We want words strictly longer than maxAllowedLen, but the regex above
  // already enforces length >=4. The maxAllowedLen filter applies to ALL-CAPS
  // words >maxAllowedLen chars (so for max=3, we flag 4+).
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1].length > maxAllowedLen) out.push({ word: m[1], offset: m.index });
  }
  return out;
}

function findBannedPhrase(text, banned) {
  const lower = text.toLowerCase();
  for (const phrase of banned) {
    const idx = lower.indexOf(phrase.toLowerCase());
    if (idx !== -1) {
      return { phrase, offset: idx };
    }
  }
  return null;
}

function firstLine(text) {
  // First non-empty line.
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines[0] || '';
}

// ─── evaluators ─────────────────────────────────────────────────────────────
//
// Each evaluator: ({ draft, dim, config, facts }) → { passed, expected, got, location }
//
//   passed:     boolean
//   expected:   string (for critic + trace)
//   got:        anything (for critic + trace)
//   location:   string (where in the draft the issue is, "" if global)

const EVALUATORS = {

  length({ draft, dim }) {
    const chars = draft.length;
    const sentences = countSentences(draft);
    const charOk = chars >= dim.min_chars && chars <= dim.max_chars;
    const sentOk = sentences >= dim.min_sentences && sentences <= dim.max_sentences;
    const passed = charOk && sentOk;
    return {
      passed,
      expected: `${dim.min_chars}-${dim.max_chars} chars, ${dim.min_sentences}-${dim.max_sentences} sentences`,
      got: `${chars} chars, ${sentences} sentences`,
      location: 'entire draft',
    };
  },

  first_line_hook({ draft, dim }) {
    const first = firstLine(draft);
    const charOk = first.length <= dim.max_chars;
    const bannedHit = findBannedPhrase(first, dim.banned_openers);
    const passed = charOk && bannedHit === null;
    const problems = [];
    if (!charOk) problems.push(`first line ${first.length} chars (max ${dim.max_chars})`);
    if (bannedHit) problems.push(`banned opener "${bannedHit.phrase}" at char ${bannedHit.offset}`);
    return {
      passed,
      expected: `first line ≤${dim.max_chars} chars, no banned opener`,
      got: problems.length ? problems.join('; ') : `first line ${first.length} chars, OK`,
      location: 'first line',
    };
  },

  formatting({ draft, dim }) {
    const paragraphs = splitParagraphs(draft);
    const count = paragraphs.length;
    const countOk = count >= dim.min_paragraphs && count <= dim.max_paragraphs;
    // Find paragraphs exceeding max sentences
    const badParas = paragraphs
      .map((p, i) => ({ i, sentences: countSentences(p) }))
      .filter(p => p.sentences > dim.max_sentences_per_paragraph);
    const passed = countOk && badParas.length === 0;
    const problems = [];
    if (!countOk) problems.push(`${count} paragraphs (need ${dim.min_paragraphs}-${dim.max_paragraphs})`);
    if (badParas.length) problems.push(`paragraphs ${badParas.map(p => p.i + 1).join(',')} exceed ${dim.max_sentences_per_paragraph} sentences`);
    return {
      passed,
      expected: `${dim.min_paragraphs}-${dim.max_paragraphs} paragraphs, each ≤${dim.max_sentences_per_paragraph} sentences`,
      got: problems.length ? problems.join('; ') : `${count} paragraphs, OK`,
      location: 'paragraph structure',
    };
  },

  emoji_count({ draft, dim }) {
    const count = countEmojis(draft);
    const passed = count >= dim.min && count <= dim.max;
    return {
      passed,
      expected: `${dim.min}-${dim.max} emojis`,
      got: `${count} emojis`,
      location: 'entire draft',
    };
  },

  hashtag_count({ draft, dim }) {
    const tags = extractHashtags(draft);
    const count = tags.length;
    const countOk = count >= dim.min && count <= dim.max;
    const formatProblems = [];
    if (dim.require_lowercase) {
      for (const t of tags) {
        if (t !== t.toLowerCase()) formatProblems.push(`#${t} not lowercase`);
      }
    }
    if (dim.require_single_word) {
      for (const t of tags) {
        if (!/^[A-Za-z0-9_]+$/.test(t)) formatProblems.push(`#${t} not single word`);
      }
    }
    const passed = countOk && formatProblems.length === 0;
    const problems = [];
    if (!countOk) problems.push(`${count} hashtags (need ${dim.min}-${dim.max})`);
    if (formatProblems.length) problems.push(formatProblems.join('; '));
    return {
      passed,
      expected: `${dim.min}-${dim.max} hashtags, all lowercase, all single-word`,
      got: problems.length ? problems.join('; ') : `${count} hashtags, OK`,
      location: 'entire draft',
    };
  },

  tone_no_cliches({ draft, dim }) {
    const hit = findBannedPhrase(draft, dim.banned_phrases);
    const passed = hit === null;
    return {
      passed,
      expected: 'no banned phrase',
      got: passed ? 'clean' : `"${hit.phrase}" at char ${hit.offset}`,
      location: passed ? '' : `char ${hit.offset}`,
    };
  },

  no_engagement_bait({ draft, dim }) {
    // Check last paragraph (or last 200 chars) for banned closings.
    const tail = draft.slice(-200);
    const hit = findBannedPhrase(tail, dim.banned_closings);
    const passed = hit === null;
    return {
      passed,
      expected: 'no engagement-bait closing',
      got: passed ? 'clean' : `"${hit.phrase}" at char ${draft.length - 200 + hit.offset}`,
      location: passed ? '' : 'closing',
    };
  },

  no_all_caps_words({ draft, dim }) {
    const hits = findAllCapsWords(draft, dim.max_word_length);
    const passed = hits.length === 0;
    return {
      passed,
      expected: `no ALL-CAPS words >${dim.max_word_length} chars`,
      got: passed ? 'clean' : hits.map(h => `"${h.word}" at char ${h.offset}`).join('; '),
      location: passed ? '' : hits.map(h => `char ${h.offset}`).join('; '),
    };
  },

  // no_unsupported_claims is handled separately because it needs the facts
  // claim-extraction module. We provide a placeholder here that the loop
  // orchestrator can override by injecting a custom evaluator. If facts are
  // absent, this dim passes by default (caller should ensure facts is set).
  no_unsupported_claims({ facts }) {
    if (!facts || !facts.enabled) {
      return { passed: true, expected: 'unsupported claims', got: 'no facts provided (skipped)', location: '' };
    }
    // Real evaluation happens in evaluate() below — see override.
    return { passed: true, expected: 'all claims supported by facts', got: 'see evaluate() override', location: '' };
  },
};

// ─── main entry ─────────────────────────────────────────────────────────────

export function evaluate(draft, rubric, facts = null) {
  if (!rubric || !rubric.dimensions) {
    throw new TypeError('sensor.evaluate: rubric must have a "dimensions" key');
  }

  const per_dim = {};
  let allPassed = true;

  for (const [name, dim] of Object.entries(rubric.dimensions)) {
    let entry;

    if (name === 'no_unsupported_claims' && facts && facts.enabled) {
      // Inline this evaluation here since it needs the facts claim diff.
      // facts shape: { keywords: string[], numbers: string[], names: string[], tools: string[] }
      const claims = facts.claims || []; // unsupported claims list
      const passed = claims.length === 0;
      entry = {
        passed,
        expected: 'all claims supported by facts',
        got: passed ? 'clean' : claims.map(c => `"${c.text}" at char ${c.offset}`).join('; '),
        location: passed ? '' : claims.map(c => `char ${c.offset}`).join('; '),
      };
    } else {
      const fn = EVALUATORS[name];
      if (!fn) {
        // Unknown dim — be loud. Don't silently pass.
        throw new Error(`sensor.evaluate: no evaluator registered for dimension "${name}". Add one to EVALUATORS in src/sensor.js.`);
      }
      entry = fn({ draft, dim, facts });
    }

    per_dim[name] = entry;
    if (!entry.passed) allPassed = false;
  }

  return { passed: allPassed, per_dim };
}
