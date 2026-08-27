#!/usr/bin/env node
/**
 * scripts/start-ui.js
 *
 * Start the Self-Correcting Draft Agent UI.
 *
 * Idempotent:
 *   - If the server is already running on PORT, just opens the browser.
 *   - Otherwise, spawns the server detached, polls until it's responsive,
 *     then opens the browser.
 *
 * Used by the OpenClaw cron job `open-self-correcting-draft-agent-ui`.
 * Can also be run directly: `node scripts/start-ui.js` or `npm run open-ui`.
 *
 * Important: server is spawned detached so this script can exit without
 * killing it. Browser is opened via Windows `Start-Process`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '3000', 10);
const URL = `http://localhost:${PORT}`;
const STATE_DIR = path.join(PROJECT_DIR, 'state');
const PIDFILE = path.join(STATE_DIR, 'server.pid');
const LOGFILE = path.join(STATE_DIR, 'server.log');

function log(...args) {
  console.log('[start-ui]', ...args);
}
function err(...args) {
  console.error('[start-ui]', ...args);
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, timeout: 500 }, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortInUse(parseInt(url.split(':').pop(), 10))) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

function startServer() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  // Spawn detached so this script can exit without killing the server.
  // stdio goes to LOGFILE so we can debug startup failures.
  const out = require('node:fs').openSync(LOGFILE, 'a');
  const errOut = out;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: PROJECT_DIR,
    detached: true,
    stdio: ['ignore', out, errOut],
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  writeFileSync(PIDFILE, String(child.pid));
  log(`spawned server pid=${child.pid} log=${LOGFILE}`);
  return child.pid;
}

function openBrowser(url) {
  // Windows: Start-Process opens in default browser. Detached, fire-and-forget.
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-Command', `Start-Process '${url}'`],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  log(`opened browser → ${url}`);
}

(async () => {
  try {
    if (await isPortInUse(PORT)) {
      log(`server already running on ${URL}`);
    } else {
      log(`starting server on port ${PORT}...`);
      startServer();
      const ready = await waitForServer(URL, 10000);
      if (!ready) {
        err(`server failed to start within 10s. Check ${LOGFILE} for details.`);
        process.exit(1);
      }
      log(`server up on ${URL}`);
    }
    openBrowser(URL);
    log('done');
    process.exit(0);
  } catch (e) {
    err(`unexpected error: ${e.message}`);
    process.exit(1);
  }
})();
