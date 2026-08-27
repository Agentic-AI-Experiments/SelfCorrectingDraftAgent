#!/usr/bin/env node
/**
 * THE 5 LOAD-BEARING TESTS. These are the showcase — they prove the
 * loop cannot run away, regardless of sensor output, LLM behavior, or
 * adversarial input.
 *
 * Run: npm test   (or: node --test tests/)
 *
 * Every test injects its own mock drafter / sensor / critic so the loop
 * is exercised in isolation. No LLM, no real sensor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loop, LOOP_DEFAULT_CAP } from '../src/loop.js';

// Minimal rubric shape — actual contents don't matter for these tests.
const RUBRIC = { length: { min: 1, max: 1000 } };

function mkDrafter(responses) {
  // responses: array of strings OR a function (i) => string
  let i = 0;
  return async () => {
    const text = typeof responses === 'function'
      ? responses(i)
      : (responses[i] ?? `draft-${i}`);
    i++;
    return { text };
  };
}

function mkSensor(verdict) {
  // verdict: boolean (always pass/fail) OR (draft, iter) => boolean
  return async ({ draft }) => {
    const passed = typeof verdict === 'function' ? verdict(draft) : verdict;
    return {
      passed,
      per_dim: {
        length: { passed, expected: '1-1000 chars', got: draft.length, location: 'entire draft' },
      },
    };
  };
}

function mkCritic() {
  return () => ['[fail:length] expected 1-1000 | got 9999 | (entire draft)'];
}

describe('loop invariants (the 5 load-bearing ones)', () => {
  it('default cap is 3', () => {
    assert.equal(LOOP_DEFAULT_CAP, 3);
  });

  it('INVARIANT 1: never iterates more than cap, regardless of sensor output', async () => {
    // Sensor ALWAYS fails. Cap = 5. Must terminate after exactly 5 iterations.
    const result = await loop({
      keywords: 'x',
      facts: { keywords: ['x'], numbers: [], names: [] },
      cap: 5,
      drafter: mkDrafter(['a', 'b', 'c', 'd', 'e']),
      sensor: mkSensor(false),
      critic: mkCritic(),
      rubric: RUBRIC,
    });
    assert.equal(result.iterations_used, 5);
    assert.equal(result.status, 'exhausted');
  });

  it('INVARIANT 2: terminates immediately when sensor passes on iter 1', async () => {
    const result = await loop({
      keywords: 'x',
      facts: { keywords: ['x'], numbers: [], names: [] },
      cap: 5,
      drafter: mkDrafter(['a', 'b', 'c', 'd', 'e']),
      sensor: mkSensor(true),
      critic: mkCritic(),
      rubric: RUBRIC,
    });
    assert.equal(result.iterations_used, 1);
    assert.equal(result.status, 'passed');
    assert.equal(result.final_draft, 'a');
  });

  it('INVARIANT 3: returns last draft + scorecard on exhaustion, never raises', async () => {
    // A normal sensor that always fails must yield a structured "exhausted"
    // response, not an exception.
    const result = await loop({
      keywords: 'x',
      facts: { keywords: ['x'], numbers: [], names: [] },
      cap: 3,
      drafter: mkDrafter(['draft-1', 'draft-2', 'draft-3']),
      sensor: mkSensor(false),
      critic: mkCritic(),
      rubric: RUBRIC,
    });
    assert.equal(result.status, 'exhausted');
    assert.equal(result.final_draft, 'draft-3');
    assert.equal(result.trace.length, 3);
    assert.ok(result.trace.every(t => t.overall === 'fail'));
  });

  it('INVARIANT 4: counter increments BEFORE the drafter call (proves structural termination)', async () => {
    // If counter incremented AFTER the drafter call, a drafter that throws on
    // every call would still cause N drafter invocations. By incrementing
    // BEFORE, the loop body checks the cap before doing work.
    //
    // We prove this by giving a drafter that records the iter values it sees
    // and assert they are exactly 1..cap (not 0..cap+1 or some other pattern).
    const seenIters = [];
    const drafter = async ({ iter }) => {
      seenIters.push(iter);
      return { text: `d${iter}` };
    };
    await loop({
      keywords: 'x',
      facts: { keywords: ['x'], numbers: [], names: [] },
      cap: 4,
      drafter,
      sensor: mkSensor(false),
      critic: mkCritic(),
      rubric: RUBRIC,
    });
    assert.deepEqual(seenIters, [1, 2, 3, 4]);
  });

  it('INVARIANT 5: iter-2 prompt includes prior draft + critic failures; iter-1 does not', async () => {
    // This proves the loop is feeding structured feedback to retries, not just
    // blindly re-asking the LLM.
    const seenInputs = [];
    const drafter = async (args) => {
      seenInputs.push({
        iter: args.iter,
        hasPriorDraft: args.priorDraft != null,
        failureCount: args.criticFailures.length,
      });
      return { text: `d${args.iter}` };
    };
    const result = await loop({
      keywords: 'x',
      facts: { keywords: ['x'], numbers: [], names: [] },
      cap: 5,
      drafter,
      sensor: mkSensor((d) => d === 'd3'),
      critic: () => ['[fail:length] bad'],
      rubric: RUBRIC,
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.iterations_used, 3);
    assert.deepEqual(seenInputs[0], { iter: 1, hasPriorDraft: false, failureCount: 0 });
    assert.deepEqual(seenInputs[1], { iter: 2, hasPriorDraft: true,  failureCount: 1 });
    assert.deepEqual(seenInputs[2], { iter: 3, hasPriorDraft: true,  failureCount: 1 });
  });
});

describe('loop input validation', () => {
  it('rejects non-function drafter', async () => {
    await assert.rejects(
      loop({
        keywords: 'x',
        facts: { keywords: [], numbers: [], names: [] },
        cap: 1, drafter: null, sensor: mkSensor(true), critic: mkCritic(), rubric: RUBRIC,
      }),
      TypeError
    );
  });
  it('rejects non-positive-integer cap', async () => {
    await assert.rejects(
      loop({
        keywords: 'x',
        facts: { keywords: [], numbers: [], names: [] },
        cap: 0, drafter: mkDrafter(['x']), sensor: mkSensor(true), critic: mkCritic(), rubric: RUBRIC,
      }),
      RangeError
    );
  });
});
