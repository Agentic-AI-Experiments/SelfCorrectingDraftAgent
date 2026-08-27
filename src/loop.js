// src/loop.js
//
// Bounded draft-critique loop orchestrator.
//
// The whole point of this module is to enforce termination structurally.
// Counter increments BEFORE the drafter call. Cap checked BEFORE each
// iteration. On exhaustion: returns last draft + last scorecard + status
// "exhausted" — never raises, never silently passes.
//
// Contract:
//   loop({ keywords, cap, drafter, sensor, critic, rubric, facts, onIter })
//     → { status, iterations_used, final_draft, trace }
//
//   status:        "passed" | "exhausted"
//   iterations_used: 1..cap
//   final_draft:   string (the best draft; on pass = the passing draft,
//                  on exhausted = the last attempted draft)
//   trace:         [{ iter, scorecard, overall, draft }]
//
// Dependencies are injected so this module is trivially testable.
// Production wiring lives in src/drafter.js / src/sensor.js / src/critic.js.

const DEFAULT_CAP = 3;

/**
 * @param {Object} args
 * @param {string|string[]} args.keywords       — input keywords / facts / prompt
 * @param {Object} args.facts                  — parsed facts object (from src/facts.js)
 * @param {number} [args.cap=3]                — max iterations
 * @param {Function} args.drafter              — (iter, keywords, priorDraft, criticFailures) → Promise<{text}>
 * @param {Function} args.sensor               — (draft, rubric, facts) → Promise<{passed, per_dim}>
 * @param {Function} args.critic               — (scorecard) → string[]
 * @param {Object} args.rubric                 — rubric config
 * @param {Function} [args.onIter]             — (iter, draft, scorecard) → void, optional telemetry hook
 */
export async function loop({
  keywords,
  facts,
  cap = DEFAULT_CAP,
  drafter,
  sensor,
  critic,
  rubric,
  onIter,
}) {
  if (typeof drafter !== 'function') throw new TypeError('loop: drafter must be a function');
  if (typeof sensor !== 'function') throw new TypeError('loop: sensor must be a function');
  if (typeof critic !== 'function') throw new TypeError('loop: critic must be a function');
  if (!rubric) throw new TypeError('loop: rubric is required');
  if (!Number.isInteger(cap) || cap < 1) throw new RangeError('loop: cap must be a positive integer');

  const trace = [];
  let lastDraft = '';
  let lastScorecard = null;

  for (let iter = 1; iter <= cap; iter++) {
    // Build drafter inputs. Iter 1: keywords + facts only.
    // Iter 2+: prior draft + critic failures as feedback.
    const priorDraft = iter === 1 ? null : lastDraft;
    const criticFailures = iter === 1 ? [] : critic(lastScorecard);

    const { text } = await drafter({
      iter,
      keywords,
      facts,
      priorDraft,
      criticFailures,
    });
    lastDraft = text;

    // Sensor evaluation. Pure function, no LLM.
    const scorecard = await sensor({ draft: text, rubric, facts });
    lastScorecard = scorecard;

    const overall = scorecard.passed ? 'pass' : 'fail';
    trace.push({ iter, draft: text, scorecard, overall });

    if (onIter) {
      try { onIter({ iter, draft: text, scorecard, overall }); } catch { /* swallow */ }
    }

    if (scorecard.passed) {
      return {
        status: 'passed',
        iterations_used: iter,
        final_draft: text,
        trace,
      };
    }
  }

  // Exhausted the cap without passing. Return last attempt + trace.
  return {
    status: 'exhausted',
    iterations_used: cap,
    final_draft: lastDraft,
    trace,
  };
}

export const LOOP_DEFAULT_CAP = DEFAULT_CAP;
