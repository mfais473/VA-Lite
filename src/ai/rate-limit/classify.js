const { readHeader } = require('../rate-headers');

const DEFAULT_WAIT_MS = 60 * 1000;
const SAFETY_MS = 1000;
const TRANSIENT_BASE_MS = 1000;
const TRANSIENT_CAP_MS = 30 * 1000;
const DEFAULT_TRANSIENT_STATUSES = [503, 504];

function parseDuration(str) {
  const s = String(str || '').trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'ms' ? n : m[2] === 'h' ? n * 3600000 : m[2] === 'm' ? n * 60000 : n * 1000;
  }
  return matched ? total : undefined;
}

function errorText(err) {
  const parts = [err && err.message];
  for (const key of ['details', 'error', 'body']) {
    const v = err && err[key];
    if (v === undefined || v === null) continue;
    try { parts.push(typeof v === 'string' ? v : JSON.stringify(v)); } catch {}
  }
  return parts.filter(Boolean).join(' ');
}

function statusOf(err) {
  const candidates = [err && err.status, err && err.statusCode, err && err.code, err && err.error && err.error.code,
    err && err.response && err.response.status];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }
  return undefined;
}

function retryAfterHint(headers) {
  const ms = Number(readHeader(headers, 'retry-after-ms'));
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const ra = readHeader(headers, 'retry-after');
  if (ra === undefined) return undefined;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(ra);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function classifyRateLimit(err, { maxWaitMs = 120000, defaultWaitMs = DEFAULT_WAIT_MS } = {}) {
  const text = errorText(err);
  const status = statusOf(err);
  const looksLimited = status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(text);
  if (!looksLimited) return { retryable: false, reason: 'bukan error limit' };

  const code = String((err && (err.code || (err.error && err.error.code))) || '');
  if (/insufficient_quota/i.test(code) || /insufficient_quota|PerDay|per day|daily|billing_not_active/i.test(text)) {
    return { retryable: false, reason: 'kuota harian atau saldo habis' };
  }

  const headers = err && (err.headers || (err.response && err.response.headers));
  let hintMs = retryAfterHint(headers);

  if (hintMs === undefined) {
    const resets = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']
      .map((h) => parseDuration(readHeader(headers, h)))
      .filter((v) => v !== undefined);
    if (resets.length) hintMs = Math.max(...resets);
  }
  if (hintMs === undefined) {
    const m = text.match(/retryDelay["'\s:=]*(\d+(?:\.\d+)?)s/i) || text.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
    if (m) hintMs = Number(m[1]) * 1000;
  }

  const baseMs = hintMs !== undefined ? hintMs : defaultWaitMs;
  const waitMs = Math.ceil(baseMs) + SAFETY_MS;
  if (waitMs > maxWaitMs) {
    return { retryable: false, waitMs, reason: `penyedia meminta menunggu sekitar ${Math.ceil(baseMs / 1000)} detik` };
  }
  return { retryable: true, waitMs, reason: hintMs !== undefined ? 'sesuai petunjuk penyedia' : 'satu jendela menit' };
}

function classifyTransient(err, { attempt = 0, maxWaitMs = 120000, statuses = DEFAULT_TRANSIENT_STATUSES, random = Math.random } = {}) {
  const status = statusOf(err);
  if (!status || !statuses.includes(status)) return { retryable: false };
  const headers = err && (err.headers || (err.response && err.response.headers));
  const hint = retryAfterHint(headers);
  const jitter = Math.floor(random() * 1000);
  if (hint !== undefined) {
    if (hint > maxWaitMs) return { retryable: false, status };
    return { retryable: true, status, waitMs: Math.ceil(hint) + jitter };
  }
  return { retryable: true, status, waitMs: Math.min(TRANSIENT_BASE_MS * 2 ** attempt, TRANSIENT_CAP_MS) + jitter };
}

module.exports = { DEFAULT_WAIT_MS, DEFAULT_TRANSIENT_STATUSES, parseDuration, classifyRateLimit, classifyTransient };
