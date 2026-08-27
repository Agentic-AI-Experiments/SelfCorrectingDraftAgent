#!/usr/bin/env node
/**
 * Tests for src/drafter.js — prompt construction + LLM call.
 *
 * The LLM call itself is mocked via src/llm.js's __setCompleteForTesting
 * test seam so these tests don't require network or secrets.
 *
 * Run: node tests/test-drafter.js   (or: npm test)
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { drafter, buildUserPrompt, DRAFTER_SYSTEM_PROMPT } from '../src/drafter.js';
import { __setCompleteForTesting } from '../src/llm.js';

afterEach(() => {
  // Always restore the real impl between tests.
  __setCompleteForTesting(null);
});

// ─── buildUserPrompt ───────────────────────────────────────────────────────

describe('drafter.buildUserPrompt', () => {
  it('iter 1: includes keywords + facts, no prior draft, no failures', () => {
    const p = buildUserPrompt({
      keywords: 'why I switched from engineering to PM',
      facts: { keywords: ['pm', 'engineering'], numbers: [], names: ['Stripe'], tools: ['react'] },
      priorDraft: null,
      criticFailures: [],
    });
    assert.match(p, /why I switched from engineering to PM/);
    assert.match(p, /Stripe/);
    assert.match(p, /react/i);
    assert.doesNotMatch(p, /previous draft/i);
    assert.doesNotMatch(p, /fail:/i);
  });

  it('iter 2+: includes prior draft + critic failures', () => {
    const p = buildUserPrompt({
      keywords: 'topic',
      facts: null,
      priorDraft: 'My prior draft text',
      criticFailures: ['[fail:length] expected 150-700 | got 845 | (entire draft)', '[fail:emoji_count] expected 1-3 | got 0 | (entire draft)'],
    });
    assert.match(p, /My prior draft text/);
    assert.match(p, /\[fail:length\]/);
    assert.match(p, /\[fail:emoji_count\]/);
  });

  it('handles array keywords (bullet list)', () => {
    const p = buildUserPrompt({
      keywords: ['bullet one', 'bullet two'],
      facts: null,
      priorDraft: null,
      criticFailures: [],
    });
    assert.match(p, /bullet one/);
    assert.match(p, /bullet two/);
  });

  it('handles empty facts gracefully', () => {
    const p = buildUserPrompt({
      keywords: 'topic',
      facts: { keywords: [], numbers: [], names: [], tools: [] },
      priorDraft: null,
      criticFailures: [],
    });
    assert.doesNotMatch(p, /\[Facts the LLM may use\]/);
  });
});

// ─── drafter (with mocked LLM) ─────────────────────────────────────────────

describe('drafter (mocked LLM)', () => {
  it('returns cleaned LLM output', async () => {
    __setCompleteForTesting(async () => ({ text: '  Hello world  ', usage: null }));
    const out = await drafter({
      iter: 1, keywords: 'topic', facts: null, priorDraft: null, criticFailures: [],
    });
    assert.equal(out.text, 'Hello world');
  });

  it('strips code fences the LLM accidentally adds', async () => {
    __setCompleteForTesting(async () => ({ text: '```\nActual post text\n```', usage: null }));
    const out = await drafter({
      iter: 1, keywords: 'topic', facts: null, priorDraft: null, criticFailures: [],
    });
    assert.equal(out.text, 'Actual post text');
  });

  it('uses lower temperature on retries (more focused)', async () => {
    let seenTemp = null;
    __setCompleteForTesting(async (args) => {
      seenTemp = args.temperature;
      return { text: 'x', usage: null };
    });
    await drafter({
      iter: 3, keywords: 'topic', facts: null, priorDraft: 'prior', criticFailures: ['[fail:length] bad'],
    });
    assert.equal(seenTemp, 0.5);
  });

  it('uses higher temperature on iter 1 (more creative)', async () => {
    let seenTemp = null;
    __setCompleteForTesting(async (args) => {
      seenTemp = args.temperature;
      return { text: 'x', usage: null };
    });
    await drafter({
      iter: 1, keywords: 'topic', facts: null, priorDraft: null, criticFailures: [],
    });
    assert.equal(seenTemp, 0.8);
  });

  it('propagates LLM errors (loud, not silent)', async () => {
    __setCompleteForTesting(async () => {
      throw new Error('mocked LLM failure');
    });
    await assert.rejects(
      drafter({ iter: 1, keywords: 'topic', facts: null, priorDraft: null, criticFailures: [] }),
      /mocked LLM failure/
    );
  });
});

// ─── system prompt shape ───────────────────────────────────────────────────

describe('drafter system prompt', () => {
  it('contains the rubric dimensions', () => {
    for (const dim of ['Length', 'First line', 'Formatting', 'Emojis', 'Hashtags', 'Tone', 'engagement-bait', 'ALL-CAPS', 'invent facts']) {
      assert.ok(
        DRAFTER_SYSTEM_PROMPT.includes(dim),
        `system prompt missing reference to "${dim}"`
      );
    }
  });

  it('instructs the model to output only the post', () => {
    assert.match(DRAFTER_SYSTEM_PROMPT, /ONLY the LinkedIn post/i);
    assert.match(DRAFTER_SYSTEM_PROMPT, /no preamble/i);
  });
});
