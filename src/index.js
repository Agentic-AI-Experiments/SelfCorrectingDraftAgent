// src/index.js
//
// Express server. Single entrypoint.
//
// Endpoints:
//   GET  /                  → static UI (public/index.html)
//   POST /api/draft         → { keywords } → { draft }
//   POST /api/iterate       → { draft, cap } → { status, iterations_used, final_draft, trace }
//   GET  /api/health        → { ok: true, version }
//
// Server-side input length caps prevent runaway LLM costs.
// All LLM calls are server-side — the browser never sees the API key.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { loop, LOOP_DEFAULT_CAP } from './loop.js';
import { loadRubric, evaluate } from './sensor.js';
import { format as criticFormat } from './critic.js';
import { extractFacts, extractClaimsFromDraft, diff } from './facts.js';
import { drafter } from './drafter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const RUBRIC_TYPE = 'linkedin_post';

const app = express();
app.use(express.json({ limit: '64kb' }));

// Static UI
app.use(express.static(PUBLIC_DIR));

// ─── /api/health ──────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '0.1.0', default_cap: LOOP_DEFAULT_CAP });
});

// ─── /api/draft ────────────────────────────────────────────────────────────

app.post('/api/draft', async (req, res) => {
  try {
    const keywords = String(req.body?.keywords || '').trim();
    if (!keywords) return res.status(400).json({ error: 'keywords is required' });
    if (keywords.length > config.limits.keywordsMaxChars) {
      return res.status(413).json({
        error: `keywords exceeds ${config.limits.keywordsMaxChars} chars`,
      });
    }

    const facts = extractFacts(keywords);
    const claims = extractClaimsFromDraft(''); // iter 1 has no draft yet, no claims to diff
    const factsDiff = diff(facts, claims);

    const { text } = await drafter({
      iter: 1,
      keywords,
      facts: factsDiff,
      priorDraft: null,
      criticFailures: [],
    });

    res.json({ draft: text });
  } catch (err) {
    console.error('[api/draft]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/iterate ─────────────────────────────────────────────────────────

app.post('/api/iterate', async (req, res) => {
  try {
    const draft = String(req.body?.draft || '').trim();
    const capRaw = req.body?.cap;
    const cap = Number.isInteger(capRaw) ? capRaw : (typeof capRaw === 'string' ? parseInt(capRaw, 10) : LOOP_DEFAULT_CAP);

    if (!draft) return res.status(400).json({ error: 'draft is required' });
    if (draft.length > config.limits.draftMaxChars) {
      return res.status(413).json({
        error: `draft exceeds ${config.limits.draftMaxChars} chars`,
      });
    }
    if (!Number.isInteger(cap) || cap < 1 || cap > 10) {
      return res.status(400).json({ error: 'cap must be an integer 1..10' });
    }

    // We don't have the original keywords from the UI in this flow.
    // The user already has a draft they want to improve, so we treat
    // the draft itself as the "facts source" — extract claims from it,
    // and any subsequent drafts will be diffed against these claims.
    // This means: if the original draft mentions a number/name/tool,
    // subsequent drafts may reuse them without being flagged.
    const facts = extractFacts(draft);
    const initialClaims = extractClaimsFromDraft(draft);
    const factsDiff = diff(facts, initialClaims);

    const rubric = loadRubric(RUBRIC_TYPE);

    const result = await loop({
      keywords: draft,
      facts: factsDiff,
      cap,
      drafter,
      sensor: ({ draft: d, rubric: r, facts: f }) => {
        // Re-extract claims from the current draft and re-diff for unsupported claim detection.
        const claims = extractClaimsFromDraft(d);
        const fd = diff(facts, claims);
        return evaluate({ draft: d, rubric: r, facts: fd });
      },
      critic: criticFormat,
      rubric,
    });

    res.json({
      status: result.status,
      iterations_used: result.iterations_used,
      final_draft: result.final_draft,
      trace: result.trace.map(t => ({
        iter: t.iter,
        overall: t.overall,
        scorecard: t.scorecard,
      })),
    });
  } catch (err) {
    console.error('[api/iterate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── start ─────────────────────────────────────────────────────────────────

const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`[self-correcting-draft-agent] listening on http://localhost:${PORT}`);
  console.log(`[self-correcting-draft-agent] default cap: ${LOOP_DEFAULT_CAP}`);
});

// Make the app testable.
export { app };
