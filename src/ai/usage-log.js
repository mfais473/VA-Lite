const { isLow, formatRate } = require('./rate-headers');

const WINDOW_MS = 60 * 1000;
let events = [];
let nowFn = () => Date.now();
let rateInfo = null;
let rateAt = 0;
let lastRateSig = '';
const RATE_FRESH_MS = 15 * 60 * 1000;
const OUTPUT_WARN_FRACTION = 0.7;

function tpmLimitInfo() {
  if (rateInfo && rateInfo.tpmLimit > 0 && nowFn() - rateAt < RATE_FRESH_MS) {
    return { limit: rateInfo.tpmLimit, source: 'penyedia' };
  }
  const n = Number(process.env.VIA_TPM_LIMIT);
  return Number.isFinite(n) && n > 0 ? { limit: n, source: 'VIA_TPM_LIMIT' } : { limit: 0, source: '' };
}

function tpmLimit() {
  return tpmLimitInfo().limit;
}

function windowTotal(now = nowFn()) {
  events = events.filter((e) => now - e.t < WINDOW_MS);
  return events.reduce((sum, e) => sum + e.total, 0);
}

function recordUsage({ model = '?', phase = '?', prompt = 0, completion = 0, cached = 0, maxTokens = 0, rate = null } = {}) {
  const total = (Number(prompt) || 0) + (Number(completion) || 0);
  const now = nowFn();
  events.push({ t: now, total });
  const win = windowTotal(now);
  const cap = Number(maxTokens) > 0 ? Number(maxTokens) : 0;
  const line = `[usage] fase=${phase} model=${model} masuk=${prompt} keluar=${completion} cache=${cached} total=${total} ` +
    `batas-keluaran=${cap || 'default'} | 60 detik terakhir=${win}`;

  let limitLine = null;
  if (rate) {
    rateInfo = rate;
    rateAt = now;
    const sig = `${rate.tier || ''}|${rate.rpmLimit ?? ''}|${rate.tpmLimit ?? ''}`;
    if (sig !== lastRateSig || isLow(rate)) limitLine = formatRate(rate);
    lastRateSig = sig;
  }

  const { limit, source } = tpmLimitInfo();
  const warns = [];
  if (limit && win > limit * 0.8) {
    warns.push(`[usage] PERINGATAN: ${win} token dalam 60 detik terakhir mendekati/melewati batas ${limit} (${source})`);
  }
  if (cap && Number(completion) >= cap * OUTPUT_WARN_FRACTION) {
    warns.push(`[usage] PERINGATAN: keluaran ${completion} token sudah ${Math.round((Number(completion) / cap) * 100)}% dari batas keluaran ${cap}; ` +
      'jawaban berikutnya berisiko terpotong');
  }
  return { total, windowTotal: win, line, limitLine, warn: warns[0] || null, warns };
}

function logUsage(info) {
  const r = recordUsage(info);
  console.log(r.line);
  if (r.limitLine) console.log(r.limitLine);
  for (const w of r.warns) console.warn(w);
  return r;
}

module.exports = {
  recordUsage, logUsage, windowTotal, tpmLimit,
  __test: { reset: () => { events = []; rateInfo = null; rateAt = 0; lastRateSig = ''; }, setNow: (fn) => { nowFn = fn; } },
};
