// public/app.js
//
// Frontend logic for the Self-Correcting Draft Agent UI.
// Vanilla JS, no framework.

const els = {
  keywords: document.getElementById('keywords'),
  draft: document.getElementById('draft'),
  cap: document.getElementById('cap'),
  generateBtn: document.getElementById('generate-btn'),
  iterateBtn: document.getElementById('iterate-btn'),
  copyBtn: document.getElementById('copy-btn'),
  generateStatus: document.getElementById('generate-status'),
  iterateStatus: document.getElementById('iterate-status'),
  trace: document.getElementById('trace'),
};

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label ?? button.textContent;
}

function setStatus(el, text, kind) {
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Generate ─────────────────────────────────────────────────────────────

els.generateBtn.addEventListener('click', async () => {
  const keywords = els.keywords.value.trim();
  if (!keywords) {
    setStatus(els.generateStatus, 'Enter keywords first', 'error');
    return;
  }

  setBusy(els.generateBtn, true, 'Generating…');
  setStatus(els.generateStatus, 'Calling LLM…');

  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    els.draft.value = data.draft;
    setStatus(els.generateStatus, 'Done', 'ok');
  } catch (err) {
    setStatus(els.generateStatus, 'Error: ' + err.message, 'error');
  } finally {
    setBusy(els.generateBtn, false, 'Generate');
  }
});

// ─── Iterate ──────────────────────────────────────────────────────────────

els.iterateBtn.addEventListener('click', async () => {
  const draft = els.draft.value.trim();
  if (!draft) {
    setStatus(els.iterateStatus, 'Enter or generate a draft first', 'error');
    return;
  }
  const cap = parseInt(els.cap.value, 10);

  setBusy(els.iterateBtn, true, 'Iterating…');
  setStatus(els.iterateStatus, `Running loop, cap=${cap}…`);

  try {
    const res = await fetch('/api/iterate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft, cap }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    els.draft.value = data.final_draft;
    renderTrace(data);
    setStatus(
      els.iterateStatus,
      data.status === 'passed'
        ? `Passed in ${data.iterations_used}/${cap}`
        : `Exhausted at ${data.iterations_used}/${cap}`,
      data.status === 'passed' ? 'ok' : 'warn'
    );
  } catch (err) {
    setStatus(els.iterateStatus, 'Error: ' + err.message, 'error');
  } finally {
    setBusy(els.iterateBtn, false, 'Iterate');
  }
});

// ─── Copy ─────────────────────────────────────────────────────────────────

els.copyBtn.addEventListener('click', async () => {
  const text = els.draft.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(els.iterateStatus, 'Copied to clipboard', 'ok');
  } catch (err) {
    // Fallback for browsers without clipboard API
    els.draft.select();
    document.execCommand('copy');
    setStatus(els.iterateStatus, 'Copied (fallback)', 'ok');
  }
});

// ─── Trace rendering ──────────────────────────────────────────────────────

function renderTrace(data) {
  const lines = [];
  lines.push(`<p class="summary"><strong>${escapeHtml(data.status)}</strong> in ${data.iterations_used} iteration(s).</p>`);
  for (const t of data.trace) {
    const overall = t.overall;
    const cls = overall === 'pass' ? 'pass' : 'fail';
    lines.push(`<details class="iter ${cls}"><summary>Iter ${t.iter}: ${overall}</summary>`);
    lines.push('<table class="scorecard"><thead><tr><th>Dim</th><th>Result</th><th>Expected</th><th>Got</th><th>Location</th></tr></thead><tbody>');
    for (const [name, entry] of Object.entries(t.scorecard.per_dim)) {
      const dimCls = entry.passed ? 'cell-pass' : 'cell-fail';
      lines.push(
        `<tr><td>${escapeHtml(name)}</td>` +
        `<td class="${dimCls}">${entry.passed ? 'PASS' : 'FAIL'}</td>` +
        `<td>${escapeHtml(entry.expected)}</td>` +
        `<td>${escapeHtml(entry.got)}</td>` +
        `<td>${escapeHtml(entry.location)}</td></tr>`
      );
    }
    lines.push('</tbody></table></details>');
  }
  els.trace.innerHTML = lines.join('\n');
}
