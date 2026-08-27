#!/usr/bin/env node
/**
 * Tests for src/critic.js — scorecard → structured failure lines.
 * Run: node tests/test-critic.js   (or: npm test)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { format, renderFeedbackBlock } from '../src/critic.js';

const SAMPLE_SCORECARD = {
  passed: false,
  per_dim: {
    length: { passed: true,  expected: '150-700 chars', got: '450 chars', location: 'entire draft' },
    first_line_hook: { passed: false, expected: 'first line ≤80 chars, no banned opener', got: 'banned opener "I\'m thrilled to" at char 0', location: 'first line' },
    emoji_count: { passed: false, expected: '1-3 emojis', got: '0 emojis', location: 'entire draft' },
    tone_no_cliches: { passed: false, expected: 'no banned phrase', got: '"blessed" at char 142', location: 'char 142' },
  },
};

// ─── format ────────────────────────────────────────────────────────────────

describe('critic.format', () => {
  it('returns empty array for fully-passing scorecard', () => {
    const r = format({ passed: true, per_dim: { length: { passed: true, expected: 'x', got: 'y', location: '' } } });
    assert.deepEqual(r, []);
  });

  it('returns empty array for null scorecard', () => {
    assert.deepEqual(format(null), []);
    assert.deepEqual(format({}), []);
  });

  it('emits one line per failed dimension', () => {
    const lines = format(SAMPLE_SCORECARD);
    assert.equal(lines.length, 3);
  });

  it('line shape: [fail:<dim>] <expected> | <got> | <location>', () => {
    const lines = format(SAMPLE_SCORECARD);
    for (const line of lines) {
      // Each line starts with [fail:<dim>] and contains exactly two ' | ' separators.
      assert.match(line, /^\[fail:[a-z_]+\]/);
      const pipeCount = (line.match(/ \| /g) || []).length;
      assert.equal(pipeCount, 2, `expected exactly two ' | ' separators in: ${line}`);
    }
  });

  it('includes the right dimensions', () => {
    const lines = format(SAMPLE_SCORECARD);
    const dims = lines.map(l => l.match(/^\[fail:([a-z_]+)\]/)[1]);
    assert.deepEqual(dims, ['first_line_hook', 'emoji_count', 'tone_no_cliches']);
  });

  it('does not include passed dimensions', () => {
    const lines = format(SAMPLE_SCORECARD);
    assert.ok(!lines.some(l => l.startsWith('[fail:length]')));
  });

  it('handles missing fields gracefully (no crash, no undefined in output)', () => {
    const card = { passed: false, per_dim: { weird: { passed: false } } };
    const lines = format(card);
    assert.equal(lines.length, 1);
    // Line should still have the [fail:<dim>] prefix and the | separators,
    // even if some fields are empty.
    assert.match(lines[0], /^\[fail:weird\]/);
    assert.ok(lines[0].includes('|'), 'should contain | separator');
    assert.ok(!lines[0].includes('undefined'), 'should not contain "undefined"');
  });

  it('skips dims where passed is not exactly true or false', () => {
    // Defensive: only include explicit pass=false.
    const card = { passed: false, per_dim: { a: { passed: false, expected: 'x', got: 'y', location: 'z' }, b: { passed: undefined, expected: 'x', got: 'y', location: 'z' } } };
    const lines = format(card);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('[fail:a]'));
  });
});

// ─── renderFeedbackBlock ───────────────────────────────────────────────────

describe('critic.renderFeedbackBlock', () => {
  it('returns empty string for passing scorecard', () => {
    const card = { passed: true, per_dim: { length: { passed: true, expected: '', got: '', location: '' } } };
    assert.equal(renderFeedbackBlock(card), '');
  });

  it('renders a multi-line block with header + lines + closing instruction', () => {
    const block = renderFeedbackBlock(SAMPLE_SCORECARD);
    assert.match(block, /Your previous draft failed the rubric on these dimensions:/);
    assert.match(block, /\[fail:first_line_hook\]/);
    assert.match(block, /\[fail:emoji_count\]/);
    assert.match(block, /\[fail:tone_no_cliches\]/);
    assert.match(block, /Fix each of the above and produce a new draft\./);
  });

  it('feedback block is suitable for prompt injection (single string)', () => {
    const block = renderFeedbackBlock(SAMPLE_SCORECARD);
    assert.equal(typeof block, 'string');
    assert.ok(block.length > 0);
  });
});
