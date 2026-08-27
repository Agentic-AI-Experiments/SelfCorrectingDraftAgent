// src/critic.js
//
// Turns a failed ScoreCard into structured failure lines.
//
// The critic is the contract between the sensor (which finds failures)
// and the drafter (which fixes them on the next iteration). Every failed
// dimension emits exactly one line in this shape:
//
//   [fail:<dim>] <expected> | <got> | <location>
//
// The drafter consumes these lines verbatim and feeds them back to the
// LLM as the next prompt's feedback section. Structured + parseable =
// the retry is feedback-driven, not vibe-driven.
//
// Contract:
//   format(scorecard) → string[]
//
//   scorecard = { passed: boolean, per_dim: { [name]: { passed, expected, got, location } } }
//
// Only failed dims are included. Order = insertion order in per_dim
// (typically the order they appear in the rubric config).

export function format(scorecard) {
  if (!scorecard || !scorecard.per_dim) return [];
  const lines = [];
  for (const [dim, entry] of Object.entries(scorecard.per_dim)) {
    if (entry && entry.passed === false) {
      const expected = String(entry.expected ?? '').trim();
      const got = String(entry.got ?? '').trim();
      const location = String(entry.location ?? '').trim();
      lines.push(`[fail:${dim}] ${expected} | ${got} | ${location}`);
    }
  }
  return lines;
}

/**
 * Render the critic lines as a single multi-line string, ready to be
 * pasted into an LLM prompt. Used by src/drafter.js to build the retry
 * feedback section.
 */
export function renderFeedbackBlock(scorecard) {
  const lines = format(scorecard);
  if (lines.length === 0) return '';
  return [
    'Your previous draft failed the rubric on these dimensions:',
    ...lines,
    '',
    'Fix each of the above and produce a new draft. Do not re-introduce the same problems.',
  ].join('\n');
}
