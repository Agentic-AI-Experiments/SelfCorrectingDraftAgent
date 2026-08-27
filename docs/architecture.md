# Architecture

> **Status:** Phase 1 in progress. Sections added as each phase lands.

## Overview

The Self-Correcting Draft Agent is a **four-module library wrapped in an Express server behind a single-page UI**:

1. **`src/loop.js`** — bounded loop orchestrator. Owns iteration counter + cap.
2. **`src/sensor.js`** — deterministic rubric evaluator. Pure functions.
3. **`src/critic.js`** — turns `ScoreCard` failures into structured feedback lines.
4. **`src/drafter.js`** — LLM call. Generates or improves a draft.
5. **`src/facts.js`** — claim extraction + unsupported-claim detection.
6. **`src/llm.js`** — OpenAI-compatible adapter (Ollama cloud).
7. **`src/index.js`** — Express server. Two routes + static file serve.
8. **`public/index.html` + `app.js` + `styles.css`** — single-page UI.
9. **`scripts/start-ui.js`** — cron helper. Idempotent start + open browser.

```
┌──────────────────────────────────────────────────────────┐
│  Browser (public/)                                       │
│  ┌────────────────────────┐                              │
│  │ [Keywords textarea]    │ [Generate]                   │
│  ├────────────────────────┤                              │
│  │ [Draft textarea]       │ [Iterate cap:3▾] [Copy]      │
│  ├────────────────────────┤                              │
│  │ Trace (collapsible)    │                              │
│  └────────────────────────┘                              │
└─────────────────────┬────────────────────────────────────┘
                      │ fetch
                      ▼
┌──────────────────────────────────────────────────────────┐
│  Express (src/index.js)                                  │
│                                                          │
│  POST /api/draft   {keywords}             → {draft}      │
│  POST /api/iterate {draft, cap}           → {status,     │
│                                              final_draft, │
│                                              trace}       │
└─────────────────────┬────────────────────────────────────┘
                      │ imports
                      ▼
┌──────────────────────────────────────────────────────────┐
│  Library (src/)                                          │
│                                                          │
│  loop(keywords, cap)                                     │
│    ├─→ drafter(keywords)              [iter 1]          │
│    ├─→ sensor(draft, rubric)                             │
│    ├─→ critic(scorecard)                                 │
│    ├─→ drafter(keywords, draft, critic) [iter 2+]        │
│    └─→ returns {status, iterations_used,                 │
│                  final_draft, trace}                      │
└──────────────────────────────────────────────────────────┘
```

## Loop invariants (the load-bearing ones)

These five tests are the showcase. They prove the loop cannot run away.

1. **Cap enforced.** Mock sensor always fails → assert `iterations_used == cap`.
2. **Early termination on pass.** Mock sensor passes on iter 1 → `iterations_used == 1`.
3. **No exceptions on exhaustion.** Returns `{status: "exhausted", final_draft, trace}`.
4. **Counter increments BEFORE the drafter call.** Proves termination is structural, not LLM-cooperative.
5. **Default cap is 3.** Matches the spec.

## Sensor design

Pure functions, no LLM. Loads `rubrics/linkedin_post.json`. Each dimension is a registered evaluator:

```js
sensor.evaluate(draft, rubric) → {
  passed: boolean,
  per_dim: {
    length:         {passed, expected, got, location},
    first_line_hook:{passed, expected, got, location},
    ...
  }
}
```

Adding a new dimension = (a) add an entry to the rubric JSON, (b) register an evaluator in `src/sensor.js`. Tests for new dims are added in `tests/test_sensor.js`.

## Critic output shape

Every failed dimension emits exactly one line:

```
[fail:<dim>] <expected> | <got> | <location>
```

Example:

```
[fail:length] expected 150-700 chars, 3-10 sentences | got 845 chars, 4 sentences | (entire draft)
[fail:first_line_hook] no banned opener | "I'm thrilled to announce..." | char 0
[fail:tone_no_cliches] no banned phrase | "crushing it" | char 142
```

This is consumed verbatim by the drafter's next-iteration prompt.

## LLM integration

`src/llm.js` exposes a single function:

```js
llm.complete({ system, user, temperature }) → { text, usage }
```

Backend: OpenAI-compatible chat completions endpoint. Reads base URL, model, and API key from the shared workspace `secrets.md` (per the `OPENCLAW_SECRETS_MD` convention from the other OpenClaw projects).

## Deployment / run model

Localhost only. Single Express process. No auth (Sam's laptop, single user).

The cron helper (`scripts/start-ui.js`) starts the server detached so it survives script exit. Browser opens via Windows `Start-Process`. Server keeps running until manually stopped or laptop shuts down.

## Why this architecture

**Three reasons:**

1. **The cap is the engineering.** Bounded iteration with structural enforcement is the whole point of the project. Everything else (rubric, critic, UI) exists to demonstrate that.
2. **Pure deterministic sensor.** Auditable, reproducible, non-circular. "Did the draft pass the rubric?" has a single deterministic answer per draft. No "vibes" or LLM-as-judge-for-the-LLM.
3. **Single static page.** Two textareas + three buttons doesn't justify a build step, a framework, or a router. `public/index.html` + `app.js` is the right size.

## Decisions log

- **2026-08-27** — Initial scaffold. Pure deterministic sensor (no LLM-as-judge). Express + vanilla JS. Local `npm install` (workspace `node_modules` lacks express + vitest).
