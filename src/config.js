// src/config.js
//
// Runtime configuration. Reads from environment first, then shared
// workspace secrets.md.
//
// IMPORTANT: this module is safe to import anywhere — it does NOT
// throw on missing values at import time. Validation happens lazily
// inside src/llm.js when the first LLM call is made. This lets tests
// import the library without requiring secrets to be present.

export const config = {
  llm: {
    baseUrl: process.env.LLM_BASE_URL || null,
    model:   process.env.LLM_MODEL    || null,
    apiKey:  process.env.LLM_API_KEY  || null,
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  // Hard upper bounds on input sizes (server-side, before LLM call).
  limits: {
    keywordsMaxChars: 500,
    draftMaxChars:    5000,
  },
};
