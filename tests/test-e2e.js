#!/usr/bin/env node
/**
 * E2E fixtures for the full library stack.
 *
 * These tests use a scripted mock LLM (not the real one) so they're
 * deterministic and run without secrets. They exercise the actual
 * src/sensor.js + src/critic.js + src/facts.js modules against the
 * full src/loop.js orchestrator.
 *
 * Run: node tests/test-e2e.js   (or: npm test)
 *
 * For a real-LLM smoke test, use scripts/start-ui.js and the browser UI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loop } from '../src/loop.js';
import { loadRubric } from '../src/sensor.js';
import { format as criticFormat } from '../src/critic.js';
import { extractFacts, diff } from '../src/facts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.resolve(__dirname, '..', 'examples');

// ─── scripted mock drafter ─────────────────────────────────────────────────
//
// Returns a drafter that produces a sequence of pre-canned drafts.
// Each draft is selected to test a specific rubric behavior.

function scriptedDrafter(sequence) {
  let i = 0;
  return async () => {
    const text = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return { text };
  };
}

// ─── fixtures ──────────────────────────────────────────────────────────────

describe('e2e: pass_at_1', () => {
  it('passes on first iteration with a clean, rubric-passing draft', async () => {
    const fixture = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, 'linkedin_post_pass_at_1.json'), 'utf8'));
    const facts = extractFacts(fixture.input);
    const rubric = loadRubric('linkedin_post');

    const passingDraft = [
      'Most PM interviews test the wrong thing.',
      '',
      'They ask you to estimate golf balls in a bus. Then they score you on whether you said 600,000.',
      '',
      'What they should test: how you handle a stakeholder who disagrees with your roadmap. That\'s the actual job.',
      '',
      'Three questions I ask instead: what problem are we solving, who decides, what did we learn last quarter.',
      '',
      '#productmanagement #hiring #startups 🚀',
    ].join('\n');

    const result = await loop({
      keywords: fixture.input,
      facts: diff(facts, []),
      cap: 3,
      drafter: scriptedDrafter([passingDraft]),
      sensor: (await import('../src/sensor.js')).evaluate,
      critic: criticFormat,
      rubric,
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.iterations_used, 1);
    assert.equal(result.final_draft, passingDraft);
  });
});

describe('e2e: pass_at_2', () => {
  it('passes on second iteration: first draft fails length, retry fixes it', async () => {
    const fixture = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, 'linkedin_post_pass_at_2.json'), 'utf8'));
    const facts = extractFacts(fixture.input);
    const rubric = loadRubric('linkedin_post');

    // First draft: too long (1000 chars), no emojis. Second draft: passing.
    const tooLong = 'word '.repeat(200); // 1000 chars, way over 700.
    const passingDraft = [
      'After 4 years leading the Stripe Radar team, I joined Acme Corp as a Senior PM.',
      '',
      'Here is what I am excited to build: faster feedback loops between engineering and product.',
      '',
      'If you have shipped at scale, I want to hear what surprised you.',
      '',
      '#productmanagement #pm 🚀',
    ].join('\n');

    const result = await loop({
      keywords: fixture.input,
      facts: diff(facts, []),
      cap: 3,
      drafter: scriptedDrafter([tooLong, passingDraft]),
      sensor: (await import('../src/sensor.js')).evaluate,
      critic: criticFormat,
      rubric,
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.iterations_used, 2);
    assert.equal(result.final_draft, passingDraft);

    // Critic feedback from iter 1 must have included length failure.
    const iter1Critic = result.trace[0].scorecard.per_dim.length;
    assert.equal(iter1Critic.passed, false);
  });
});

describe('e2e: exhausted_at_3', () => {
  it('exhausts at cap=3 when the drafter cannot satisfy the tone_no_cliches dim', async () => {
    const fixture = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, 'linkedin_post_exhausted_at_3.json'), 'utf8'));
    const facts = extractFacts(fixture.input);
    const rubric = loadRubric('linkedin_post');

    // All three drafts contain the banned phrase "blessed" or "crushing it".
    // The sensor will keep flagging tone_no_cliches. With cap=3, the loop
    // exhausts and returns the last attempted draft.
    const badDraft = (label) => [
      `I feel so blessed to share update ${label}.`,
      '',
      'Crushing it at the new role.',
      '',
      'Synergy will unlock value for everyone.',
    ].join('\n');

    const result = await loop({
      keywords: fixture.input,
      facts: diff(facts, []),
      cap: 3,
      drafter: scriptedDrafter([badDraft(1), badDraft(2), badDraft(3)]),
      sensor: (await import('../src/sensor.js')).evaluate,
      critic: criticFormat,
      rubric,
    });

    assert.equal(result.status, 'exhausted');
    assert.equal(result.iterations_used, 3);
    assert.equal(result.trace.length, 3);
    assert.equal(result.final_draft, badDraft(3));

    // Every iteration should have failed tone_no_cliches.
    for (const t of result.trace) {
      assert.equal(t.scorecard.per_dim.tone_no_cliches.passed, false,
        `iter ${t.iter} should have failed tone_no_cliches`);
    }
  });
});

// ─── cross-cutting e2e invariants ──────────────────────────────────────────

describe('e2e: invariants in a wired-up stack', () => {
  it('critic feedback from failed iter becomes drafter input on retry', async () => {
    const rubric = loadRubric('linkedin_post');
    const tooLong = 'word '.repeat(200);
    const passingDraft = [
      'Most PM interviews test the wrong thing.',
      '',
      'They ask you to estimate golf balls in a bus. Then they score you on whether you said 600,000.',
      '',
      'What they should test: how you handle a stakeholder who disagrees with your roadmap.',
      '',
      'Three questions I ask instead: what problem are we solving, who decides, what did we learn.',
      '',
      '#productmanagement #hiring #startups 🚀',
    ].join('\n');

    const seenInputs = [];
    const drafter = async (args) => {
      seenInputs.push({
        iter: args.iter,
        hasPrior: args.priorDraft != null,
        failures: args.criticFailures,
      });
      return { text: args.iter === 1 ? tooLong : passingDraft };
    };

    const result = await loop({
      keywords: 'topic',
      facts: { enabled: true, keywords: [], numbers: [], names: [], tools: [], claims: [] },
      cap: 3,
      drafter,
      sensor: (await import('../src/sensor.js')).evaluate,
      critic: criticFormat,
      rubric,
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.iterations_used, 2);
    // Iter 1: no prior, no failures.
    assert.equal(seenInputs[0].hasPrior, false);
    assert.equal(seenInputs[0].failures.length, 0);
    // Iter 2: prior + failures (length at minimum).
    assert.equal(seenInputs[1].hasPrior, true);
    assert.ok(seenInputs[1].failures.some(f => f.startsWith('[fail:length]')));
  });

  it('cap=1: a single failing iter returns exhausted (no silent pass)', async () => {
    const rubric = loadRubric('linkedin_post');
    const tooShort = 'x';
    const result = await loop({
      keywords: 'topic',
      facts: { enabled: true, keywords: [], numbers: [], names: [], tools: [], claims: [] },
      cap: 1,
      drafter: scriptedDrafter([tooShort]),
      sensor: (await import('../src/sensor.js')).evaluate,
      critic: criticFormat,
      rubric,
    });
    assert.equal(result.status, 'exhausted');
    assert.equal(result.iterations_used, 1);
    assert.equal(result.final_draft, tooShort);
  });
});
