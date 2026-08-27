#!/usr/bin/env node
/**
 * Tests for src/sensor.js — per-dimension coverage.
 * Run: node tests/test-sensor.js   (or: npm test)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadRubric, evaluate } from '../src/sensor.js';

const rubric = loadRubric('linkedin_post');

const PASSING_DRAFT = [
  'Most PM interviews test the wrong thing.',
  '',
  'They ask you to estimate how many golf balls fit in a bus. Then they score you on whether you said 600,000.',
  '',
  'What they should test: how you handle a stakeholder who disagrees with your roadmap. That\'s the actual job.',
  '',
  'Three questions I ask instead: what problem are we solving, who decides, what did we learn last quarter.',
  '',
  '#productmanagement #hiring #startups 🚀'
].join('\n');

// ─── length ────────────────────────────────────────────────────────────────

describe('sensor.length', () => {
  it('passes for a draft in range', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.per_dim.length.passed, true);
  });
  it('fails when too short', () => {
    const short = 'Hi.\n\nI am Sam.';
    const r = evaluate(short, rubric);
    assert.equal(r.per_dim.length.passed, false);
    assert.match(r.per_dim.length.got, /\d+ chars/);
  });
  it('fails when too long', () => {
    const long = 'word '.repeat(500);
    const r = evaluate(long, rubric);
    assert.equal(r.per_dim.length.passed, false);
  });
});

// ─── first_line_hook ───────────────────────────────────────────────────────

describe('sensor.first_line_hook', () => {
  it('passes for a sharp, short first line', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.per_dim.first_line_hook.passed, true);
  });
  it('fails for banned opener "I\'m thrilled to"', () => {
    const draft = "I'm thrilled to announce I'm joining Acme Corp as a PM!\n\n" + PASSING_DRAFT.slice(20);
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.first_line_hook.passed, false);
    assert.match(r.per_dim.first_line_hook.got, /banned opener/i);
  });
  it('fails for banned opener "So,"', () => {
    const draft = "So, I started a new role last week.\n\n" + PASSING_DRAFT.slice(20);
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.first_line_hook.passed, false);
  });
  it('fails when first line >80 chars', () => {
    const draft = 'a'.repeat(100) + '\n\n' + PASSING_DRAFT.slice(20);
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.first_line_hook.passed, false);
  });
});

// ─── formatting ────────────────────────────────────────────────────────────

describe('sensor.formatting', () => {
  it('passes for a properly broken-up draft', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.per_dim.formatting.passed, true);
  });
  it('fails when no paragraph breaks', () => {
    const draft = 'One long paragraph with no breaks at all. Just sentences smushed together. Another sentence here. And another. And one more. Plus more text.';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.formatting.passed, false);
    assert.match(r.per_dim.formatting.got, /paragraphs/i);
  });
  it('fails when a paragraph exceeds 3 sentences', () => {
    const draft = [
      'Hook.',
      '',
      'One. Two. Three. Four. Five.',
      '',
      'More text here.'
    ].join('\n');
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.formatting.passed, false);
    assert.match(r.per_dim.formatting.got, /exceed/);
  });
});

// ─── emoji_count ──────────────────────────────────────────────────────────

describe('sensor.emoji_count', () => {
  it('passes with 1-3 emojis', () => {
    const r = evaluate(PASSING_DRAFT + ' 🚀', rubric);
    assert.equal(r.per_dim.emoji_count.passed, true);
  });
  it('fails with 0 emojis', () => {
    // Build a draft that passes everything else but has no emojis.
    const draft = 'Sharp opening line that hooks.\n\nBody paragraph one.\n\nClosing line.\n\n#pm';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.emoji_count.passed, false);
  });
  it('fails with >3 emojis', () => {
    const r = evaluate(PASSING_DRAFT + ' 🚀 🎉 💡 🔥', rubric);
    assert.equal(r.per_dim.emoji_count.passed, false);
  });
});

// ─── hashtag_count ────────────────────────────────────────────────────────

describe('sensor.hashtag_count', () => {
  it('passes with 3 lowercase single-word hashtags', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.per_dim.hashtag_count.passed, true);
  });
  it('fails with uppercase hashtag', () => {
    const draft = PASSING_DRAFT.replace('#productmanagement', '#ProductManagement');
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.hashtag_count.passed, false);
  });
  it('fails with >5 hashtags', () => {
    const draft = PASSING_DRAFT + ' #one #two #three #four #five #six';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.hashtag_count.passed, false);
  });
});

// ─── tone_no_cliches ──────────────────────────────────────────────────────

describe('sensor.tone_no_cliches', () => {
  it('passes for a clean draft', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.per_dim.tone_no_cliches.passed, true);
  });
  it('fails on "blessed"', () => {
    const draft = PASSING_DRAFT + ' I feel blessed.';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.tone_no_cliches.passed, false);
  });
  it('fails on "thought leader"', () => {
    const draft = PASSING_DRAFT + ' As a thought leader, I think...';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.tone_no_cliches.passed, false);
  });
  it('is case-insensitive', () => {
    const draft = PASSING_DRAFT + ' CRUSHING IT lately.';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.tone_no_cliches.passed, false);
  });
});

// ─── no_engagement_bait ───────────────────────────────────────────────────

describe('sensor.no_engagement_bait', () => {
  it('passes for a clean ending', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.per_dim.no_engagement_bait.passed, true);
  });
  it('fails on "Thoughts?"', () => {
    const draft = PASSING_DRAFT + ' Thoughts?';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.no_engagement_bait.passed, false);
  });
  it('fails on "Repost if you"', () => {
    const draft = PASSING_DRAFT + ' Repost if you agree.';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.no_engagement_bait.passed, false);
  });
});

// ─── no_all_caps_words ────────────────────────────────────────────────────

describe('sensor.no_all_caps_words', () => {
  it('passes for normal text + acronyms ≤3 chars', () => {
    const r = evaluate(PASSING_DRAFT + ' PM tip: ship fast.', rubric);
    assert.equal(r.per_dim.no_all_caps_words.passed, true);
  });
  it('fails on words >3 chars in ALL-CAPS', () => {
    const draft = PASSING_DRAFT + ' THIS IS BAD.';
    const r = evaluate(draft, rubric);
    assert.equal(r.per_dim.no_all_caps_words.passed, false);
  });
});

// ─── no_unsupported_claims (with facts) ───────────────────────────────────

describe('sensor.no_unsupported_claims', () => {
  it('passes when no claims', () => {
    const facts = { enabled: true, keywords: ['pm'], numbers: [], names: [], tools: [], claims: [] };
    const r = evaluate(PASSING_DRAFT, rubric, facts);
    assert.equal(r.per_dim.no_unsupported_claims.passed, true);
  });
  it('fails on unsupported number claim', () => {
    const facts = {
      enabled: true,
      keywords: ['pm'],
      numbers: [],
      names: [],
      tools: [],
      claims: [{ text: '40%', offset: 100 }],
    };
    const r = evaluate(PASSING_DRAFT, rubric, facts);
    assert.equal(r.per_dim.no_unsupported_claims.passed, false);
  });
  it('skips when facts not enabled', () => {
    const r = evaluate(PASSING_DRAFT, rubric, null);
    assert.equal(r.per_dim.no_unsupported_claims.passed, true);
  });
});

// ─── overall ──────────────────────────────────────────────────────────────

describe('sensor overall', () => {
  it('returns passed=true only when every dimension passes', () => {
    const r = evaluate(PASSING_DRAFT, rubric);
    assert.equal(r.passed, true);
  });
  it('returns passed=false when any dimension fails', () => {
    const draft = 'short';
    const r = evaluate(draft, rubric);
    assert.equal(r.passed, false);
    // Many dims should be failing here.
    const failedCount = Object.values(r.per_dim).filter(d => !d.passed).length;
    assert.ok(failedCount > 1, 'expected multiple dims to fail on a too-short draft');
  });
  it('throws on unknown rubric dim (loud, not silent)', () => {
    const bad = { dimensions: { mystery_dim: {} } };
    assert.throws(() => evaluate(PASSING_DRAFT, bad), /no evaluator registered/);
  });
});
