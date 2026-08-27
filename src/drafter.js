// src/drafter.js
//
// LLM-powered drafter. Called by src/loop.js on each iteration.
//
// Iter 1: generates from keywords/facts only.
// Iter 2+: receives the prior draft + critic failures as feedback, and
//           asks the LLM to fix them.
//
// System prompt is constant across all iterations (so the rubric stays
// authoritative — the drafter is just told to satisfy it). User prompt
// changes per iteration.
//
// Returns: { text } matching the contract expected by src/loop.js.

import { complete } from './llm.js';

const SYSTEM_PROMPT = `You are a LinkedIn post writer. Your job is to write short, sharp posts that score well on this rubric:

- Length: 150-700 chars, 3-10 sentences.
- First line: a sharp hook, no clichéd opener ("I'm thrilled to", "I'm excited to", "I just", "So,", "Today I").
- Formatting: 2-6 paragraphs separated by blank lines. Each paragraph ≤3 sentences.
- Emojis: 1-3 total.
- Hashtags: 0-5, all lowercase single-word (#productmanagement not #ProductManagement).
- Tone: no cliches ("blessed", "thought leader", "rockstar", "ninja", "guru", "crushing it", "killing it", "10x engineer", "synergy", "circle back", "move the needle", "unlock value").
- No engagement-bait closings ("Thoughts?", "Agree?", "Like if you...", "Repost if you...", "Share if you...", "Comment below", "Drop a comment", "Who else", "Tag someone").
- No ALL-CAPS words longer than 3 characters.
- Do not invent facts. Numbers, employer names, tool names, or metrics that aren't in the user's input must not appear.

Output ONLY the LinkedIn post text. No preamble, no explanation, no markdown code fences.`;

/**
 * Build the user message for iter N.
 *
 * @param {Object} args
 * @param {string|string[]} args.keywords        — user-provided keywords / facts
 * @param {Object} args.facts                   — parsed facts (from src/facts.js)
 * @param {string|null} args.priorDraft         — null on iter 1
 * @param {string[]} args.criticFailures        — empty on iter 1
 */
export function buildUserPrompt({ keywords, facts, priorDraft, criticFailures }) {
  const kwText = Array.isArray(keywords) ? keywords.join('\n- ') : String(keywords || '');
  const factsBlock = formatFactsBlock(facts);

  if (!priorDraft) {
    return [
      `User keywords / facts:`,
      ``,
      kwText,
      ``,
      factsBlock,
      ``,
      `Write a LinkedIn post on this topic. Output only the post text.`,
    ].filter(Boolean).join('\n');
  }

  return [
    `User keywords / facts:`,
    ``,
    kwText,
    ``,
    factsBlock,
    ``,
    `Your previous draft:`,
    ``,
    priorDraft,
    ``,
    `Rubric failures to fix:`,
    ``,
    criticFailures.map(l => `- ${l}`).join('\n'),
    ``,
    `Rewrite the draft, fixing each of the above failures. Do not re-introduce the same problems. Output only the new post text.`,
  ].join('\n');
}

function formatFactsBlock(facts) {
  if (!facts) return '';
  const parts = [];
  if (facts.keywords?.length) parts.push(`Keywords: ${facts.keywords.join(', ')}`);
  if (facts.numbers?.length)  parts.push(`Numbers provided: ${facts.numbers.join(', ')}`);
  if (facts.names?.length)    parts.push(`Names provided: ${facts.names.join(', ')}`);
  if (facts.tools?.length)    parts.push(`Tools mentioned: ${facts.tools.join(', ')}`);
  if (parts.length === 0) return '';
  return `[Facts the LLM may use]\n${parts.join('\n')}`;
}

/**
 * Production drafter: calls the real LLM.
 * Injectable for tests via src/loop.js drafter param.
 */
export async function drafter({ iter, keywords, facts, priorDraft, criticFailures }) {
  const user = buildUserPrompt({ keywords, facts, priorDraft, criticFailures });
  const { text } = await complete({
    system: SYSTEM_PROMPT,
    user,
    temperature: iter === 1 ? 0.8 : 0.5, // more creative on first try, more focused on retries
  });
  // Strip any accidental code fences or leading "Here's..." preamble.
  return { text: cleanOutput(text) };
}

function cleanOutput(text) {
  let t = String(text || '').trim();
  // Strip code fences if the model adds them despite instructions.
  t = t.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```\s*$/, '');
  return t.trim();
}

/** Exposed for tests / reuse. */
export const DRAFTER_SYSTEM_PROMPT = SYSTEM_PROMPT;
