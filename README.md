# Self-Correcting Draft Agent

A draft-critique loop for LinkedIn posts. Rubric-based sensor, bounded iteration, copy-to-clipboard UI.

> **Status:** Phase 1 in progress. Library + Express server + UI + cron helper.

## What this is

A web UI with two text boxes:

1. **Keywords** → click **Generate** → gets a first-draft LinkedIn post.
2. **Your draft** → click **Iterate** → runs the draft-critique loop (rubric → critique → redraft) up to N times → displays the final result + trace → **Copy** to clipboard.

The loop is **bounded by a fixed iteration cap** (default 3) — termination is structural, not LLM-cooperative. Never runs away.

## Quick start (local dev)

```bash
# 1. Clone
git clone git@github.com:Agentic-AI-Experiments/SelfCorrectingDraftAgent.git
cd SelfCorrectingDraftAgent

# 2. Install (local; see "Dependencies" below)
npm install

# 3. Ensure shared secrets.md exists at:
#    C:\Users\Admin\.openclaw\workspace\secrets.md
#    with LLM_BASE_URL, LLM_MODEL, LLM_API_KEY (or set via .env / env vars)

# 4. Run tests
npm test

# 5. Start the server
npm start
# → http://localhost:3000
```

## How to use the UI

1. Open `http://localhost:3000` in a browser.
2. Top box: type keywords / a topic / facts to include.
3. Click **Generate** → bottom box fills with the first draft.
4. Click **Iterate** → the loop runs, bottom box replaces with the improved draft, trace appears below.
5. Click **Copy** → draft is on your clipboard. Paste into LinkedIn.

Iteration cap is configurable via the dropdown next to the **Iterate** button (1 / 2 / 3 / 5, default 3).

## Architecture overview

See [`docs/architecture.md`](./docs/architecture.md) for the full picture.

**TL;DR:** 4-module library + 1 Express route file + 1 static HTML page.

- **`src/loop.js`** — bounded loop orchestrator. Owns iteration counter + cap. Counter increments **before** drafter call (proves termination is structural, not LLM-cooperative).
- **`src/sensor.js`** — deterministic rubric evaluator. Pure functions, no LLM. Loads `rubrics/linkedin_post.json` and returns a `ScoreCard` with per-dimension pass/fail + offending span.
- **`src/critic.js`** — turns a failed `ScoreCard` into structured `[fail:<dim>] <expected> | <got> | <location>` lines. Consumed verbatim by the drafter's next prompt.
- **`src/drafter.js`** — LLM call. Iter 1 gets keywords/facts only; retries get prior draft + critic failures as feedback.
- **`src/facts.js`** — extract claims (numbers, names, tools) from user input; diff against draft to catch unsupported claims.
- **`src/llm.js`** — OpenAI-compatible adapter (Ollama cloud or any compatible endpoint).
- **`src/index.js`** — Express server. Two routes: `POST /api/draft` (keywords → first draft) and `POST /api/iterate` (draft + cap → final draft + trace). Serves `public/` statically.
- **`public/`** — single HTML page + vanilla JS. No build step.
- **`scripts/start-ui.js`** — cron helper. Idempotent: starts server if not running, then opens browser.
- **`state/runs/`** — per-run trace JSON (gitignored).

## Rubric dimensions

Configured in `rubrics/linkedin_post.json`. The sensor evaluates these against every draft:

| Dim | Rule |
|---|---|
| `length` | 150–700 chars, 3–10 sentences |
| `first_line_hook` | first line ≤80 chars, no banned openers ("I'm thrilled to", "I'm excited to", "I just", "So", "Today I") |
| `formatting` | 2–6 paragraph breaks (`\n\n`), no paragraph >3 sentences |
| `emoji_count` | 1–3 emojis total |
| `hashtag_count` | 0–5 hashtags, all lowercase, all single-word |
| `tone_no_cliches` | no "blessed", "grateful for this opportunity", "thought leader", "rockstar", "ninja", "guru", "crushing it", "killing it", "10x engineer" |
| `no_engagement_bait` | no closing "Thoughts?", "Agree?", "Like if you...", "Repost if you..." |
| `no_all_caps_words` | no ALL-CAPS words >3 chars (acronyms ≤3 allowed) |
| `no_unsupported_claims` | every number, named employer, named tool, metric must appear in user-provided keywords/facts |

## Cron — open the UI from chat

Registered with the OpenClaw gateway as `open-self-correcting-draft-agent-ui`:

- **Cron ID:** `<assigned at registration>`
- **`sessionTarget`:** `isolated`
- **`payload.kind`:** `agentTurn` running `scripts/start-ui.js`
- **`enabled`:** `false` (manual trigger from chat, matching the laptop-asleep pattern in MEMORY.md)
- **Manual trigger:** `cron run --id <id> --force`

When triggered, the cron:
1. Checks if a server is already running on port 3000.
2. If not, spawns `node src/index.js` detached in the background (logs to `state/server.log`).
3. Polls until the server responds (up to 10s).
4. Opens `http://localhost:3000` in the default browser.
5. Reports success/failure back via delivery.

Idempotent — safe to trigger multiple times.

## Tests

```bash
npm test
```

Suite covers:
- **Loop invariants** (5 tests — the load-bearing ones)
- **Sensor** per-dimension coverage (happy path + failure cases)
- **Critic** output structure
- **Facts** claim extraction + diff
- **Drafter** mocked-LLM tests
- **E2E** 3 fixtures: `pass_at_1`, `pass_at_2`, `exhausted_at_3`

## Dependencies

Unlike DailyJobAggregatorAgent (which resolves via NODE_PATH to the shared OpenClaw workspace `node_modules`), this project installs its own deps locally because `express` and `vitest` are not in the shared workspace `node_modules`. Standard Node practice.

## Security

- API key never reaches the browser. All LLM calls are server-side.
- Input length caps server-side (keywords ≤500 chars, draft ≤5000 chars).
- No auth — localhost single-user only. Bind to `127.0.0.1` only if exposing beyond localhost.
- `state/runs/` is gitignored; per-run traces contain user input.

## License

Public repo, no license specified. Add one before wide reuse.
