// src/utils/secrets.js
//
// Shared secrets loader. Reads from the OpenClaw workspace secrets.md file
// (C:\Users\Admin\.openclaw\workspace\secrets.md by default). All OpenClaw
// cron agents on this host use the same shared file per the
// "shared secrets file" convention documented in workspace MEMORY.md
// (2026-08-27 entry).
//
// Resolution order at runtime:
//   1. process.env[<NAME>] — wins if set (allows cron-time overrides).
//   2. Fall back to parsing OPENCLAW_SECRETS_MD for `KEY=*** lines.
//   3. If neither is set, returns null — caller decides what to do
//      (fail loudly with a clear missing-secret message).
//
// Override the secrets file path by setting OPENCLAW_SECRETS_MD in the env.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_SECRETS_MD = path.join(
  homedir(),
  '.openclaw',
  'workspace',
  'secrets.md'
);

function loadSecretsFile() {
  const secretsPath = process.env.OPENCLAW_SECRETS_MD || DEFAULT_SECRETS_MD;
  if (!existsSync(secretsPath)) return {};

  const text = readFileSync(secretsPath, 'utf8');
  // Match `KEY=value` lines, value can be unquoted or quoted.
  const re = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gm;
  const out = {};
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, key, dq, sq, bare] = m;
    out[key] = dq ?? sq ?? bare;
  }
  return out;
}

const FILE_CACHE = loadSecretsFile();

/**
 * Resolve a secret by name. Env wins; falls back to secrets.md.
 * Returns undefined if neither is set.
 */
export function secret(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
    return process.env[name];
  }
  return FILE_CACHE[name];
}

/**
 * Resolve a required secret. Throws a clear error if missing.
 */
export function requireSecret(name) {
  const v = secret(name);
  if (v == null || v === '') {
    throw new Error(
      `Missing required secret: ${name}\n` +
      `  - Set ${name}=... in your environment, OR\n` +
      `  - Add ${name}=... to OPENCLAW_SECRETS_MD (default: ${DEFAULT_SECRETS_MD})`
    );
  }
  return v;
}

/** Path to the loaded secrets file (for diagnostics). */
export const SECRETS_PATH = process.env.OPENCLAW_SECRETS_MD || DEFAULT_SECRETS_MD;
