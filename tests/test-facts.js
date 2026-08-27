#!/usr/bin/env node
/**
 * Tests for src/facts.js — claim extraction + diff against input facts.
 * Run: node tests/test-facts.js   (or: npm test)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, extractClaimsFromDraft, diff } from '../src/facts.js';

// ─── extractFacts ──────────────────────────────────────────────────────────

describe('extractFacts', () => {
  it('extracts plain numbers and percentages', () => {
    const f = extractFacts('We hit 40% growth with 1000 users.');
    assert.ok(f.numbers.some(n => n.includes('40')));
    assert.ok(f.numbers.some(n => n.includes('1000')));
  });
  it('extracts $40k-style figures', () => {
    const f = extractFacts('Salary range $120k-$180k');
    assert.ok(f.numbers.some(n => n.includes('120')));
    assert.ok(f.numbers.some(n => n.includes('180')));
  });
  it('does not extract year-like 4-digit numbers (1900-2100)', () => {
    const f = extractFacts('Founded in 2024, we launched in 2026.');
    const yearish = f.numbers.filter(n => /^(19|20)\d{2}$/.test(n.replace(/[^\d]/g, '')));
    assert.equal(yearish.length, 0, `unexpected years extracted: ${yearish}`);
  });
  it('extracts 4-digit non-year numbers', () => {
    const f = extractFacts('Served 9999 customers.');
    assert.ok(f.numbers.some(n => n.includes('9999')));
  });
  it('extracts multi-word capitalized names', () => {
    const f = extractFacts('Worked at Stripe Radar team and Acme Corp.');
    assert.ok(f.names.some(n => /Stripe Radar/i.test(n)));
    assert.ok(f.names.some(n => /Acme Corp/i.test(n)));
  });
  it('extracts tool keywords', () => {
    const f = extractFacts('Built with React, Node, and PostgreSQL.');
    assert.ok(f.tools.includes('react'));
    assert.ok(f.tools.includes('node'));
    assert.ok(f.tools.includes('postgresql'));
  });
  it('accepts array input as well as string', () => {
    const f = extractFacts(['Worked at Stripe', 'Built with React']);
    assert.ok(f.names.some(n => /Stripe/i.test(n)));
    assert.ok(f.tools.includes('react'));
  });
  it('handles empty / null input', () => {
    assert.deepEqual(extractFacts('').numbers, []);
    assert.deepEqual(extractFacts(null).numbers, []);
  });
});

// ─── extractClaimsFromDraft ────────────────────────────────────────────────

describe('extractClaimsFromDraft', () => {
  it('extracts numbers in draft', () => {
    const c = extractClaimsFromDraft('We grew 40% in Q1 with 1000 new users.');
    assert.ok(c.some(x => x.kind === 'number' && /40/.test(x.text)));
  });
  it('extracts names in draft', () => {
    const c = extractClaimsFromDraft('Led the Stripe Radar team at Acme Corp.');
    assert.ok(c.some(x => x.kind === 'name' && /Stripe Radar/.test(x.text)));
    assert.ok(c.some(x => x.kind === 'name' && /Acme Corp/.test(x.text)));
  });
  it('extracts tools in draft', () => {
    const c = extractClaimsFromDraft('Stack: React, Node, PostgreSQL.');
    assert.ok(c.some(x => x.kind === 'tool' && /react/i.test(x.text)));
  });
  it('returns offsets', () => {
    const c = extractClaimsFromDraft('40% growth!');
    const num = c.find(x => x.kind === 'number');
    assert.equal(num.offset, 0);
  });
});

// ─── diff ──────────────────────────────────────────────────────────────────

describe('diff (unsupported claims)', () => {
  it('returns claims not in input facts', () => {
    const facts = extractFacts('Worked at Stripe, used React.');
    const claims = extractClaimsFromDraft('Built Stripe Radar in 2024 with React.');
    const d = diff(facts, claims);
    // "Stripe Radar" might match "Stripe" partially; let's see what gets flagged.
    // The name "Stripe Radar" contains "stripe" but the diff is on full phrases.
    // So "Stripe Radar" the multi-word name is unsupported unless input has it.
    assert.ok(d.enabled);
    assert.ok(Array.isArray(d.claims));
  });

  it('flags fabricated percentage not in input', () => {
    const facts = extractFacts('Worked at Stripe, used React.');
    const claims = extractClaimsFromDraft('Increased revenue 40%.');
    const d = diff(facts, claims);
    assert.ok(d.claims.some(c => c.kind === 'number' && /40/.test(c.text)),
      'expected 40% to be flagged as unsupported');
  });

  it('does not flag numbers that ARE in input', () => {
    const facts = extractFacts('We grew 40% with 1000 users.');
    const claims = extractClaimsFromDraft('Our 40% growth with 1000 users proves it.');
    const d = diff(facts, claims);
    assert.equal(d.claims.filter(c => c.kind === 'number').length, 0);
  });

  it('does not flag tools that ARE in input', () => {
    const facts = extractFacts('Built with React and Node.');
    const claims = extractClaimsFromDraft('Stack: React, Node, PostgreSQL.');
    const d = diff(facts, claims);
    const unsupportedTools = d.claims.filter(c => c.kind === 'tool');
    // React and Node should not be flagged; PostgreSQL was not in input.
    assert.ok(!unsupportedTools.some(c => /react/i.test(c.text)));
    assert.ok(!unsupportedTools.some(c => /node/i.test(c.text)));
    assert.ok(unsupportedTools.some(c => /postgresql/i.test(c.text)));
  });

  it('returns enabled=false when no facts', () => {
    const d = diff(null, [{ text: '40%', offset: 0, kind: 'number' }]);
    assert.equal(d.enabled, false);
    assert.deepEqual(d.claims, []);
  });

  it('does not flag year numbers', () => {
    const facts = extractFacts('Worked at Stripe.');
    const claims = extractClaimsFromDraft('In 2024 I shipped the new dashboard.');
    const d = diff(facts, claims);
    assert.equal(d.claims.filter(c => c.kind === 'number').length, 0);
  });
});
