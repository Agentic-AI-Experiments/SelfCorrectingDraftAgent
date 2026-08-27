// src/llm.js
//
// Thin OpenAI-compatible LLM adapter. One function: complete().
//
// Reads config from src/config.js (env first). Falls back to shared
// workspace secrets.md if env values are absent. Throws loud on missing
// required values at call time (not import time — so the library can be
// imported anywhere without secrets).
//
// Test seam: `__setCompleteForTesting(fn)` replaces the implementation.
// Used by tests/test-drafter.js to mock the LLM without monkey-patching
// the read-only ESM module object.
//
// Contract:
//   complete({ system, user, temperature? }) → { text, usage }
//   throws Error on missing secrets / HTTP / parse / shape failure.

import { config } from './config.js';
import { requireSecret } from './utils/secrets.js';

let _completeImpl = realComplete;

export function __setCompleteForTesting(fn) {
  _completeImpl = fn || realComplete;
}

export async function complete(args) {
  return _completeImpl(args);
}

async function realComplete({ system, user, temperature = 0.7 }) {
  if (!system) throw new Error('llm.complete: "system" is required');
  if (!user)   throw new Error('llm.complete: "user" is required');

  // Lazy secret resolution: env wins, secrets.md fallback, throw if neither.
  const baseUrl = config.llm.baseUrl || requireSecret('LLM_BASE_URL');
  const model   = config.llm.model   || requireSecret('LLM_MODEL');
  const apiKey  = config.llm.apiKey  || requireSecret('LLM_API_KEY');

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    temperature,
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`llm.complete: network error: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`llm.complete: HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`llm.complete: invalid JSON response: ${err.message}`);
  }

  // OpenAI-compatible shape: { choices: [{ message: { content: "..." }], usage: {...} }
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error(`llm.complete: unexpected response shape: ${JSON.stringify(data).slice(0, 500)}`);
  }
  const text = data.choices[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error(`llm.complete: missing message.content: ${JSON.stringify(data.choices[0]).slice(0, 500)}`);
  }

  return { text, usage: data.usage || null };
}
