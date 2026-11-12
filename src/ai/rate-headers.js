'use strict';

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const v = headers.get(name);
    return v === null ? undefined : v;
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function parseRateHeaders(headers) {
  if (!headers) return null;
  const tierRaw = readHeader(headers, 'x-anoman-tier');
  const tier = typeof tierRaw === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(tierRaw.trim()) ? tierRaw.trim().toLowerCase() : undefined;
  const info = {
    tier,
    rpmLimit: num(readHeader(headers, 'x-anoman-rate-limit-rpm')),
    rpmRemaining: num(readHeader(headers, 'x-anoman-rate-remaining-rpm')),
    tpmLimit: num(readHeader(headers, 'x-anoman-rate-limit-tpm')),
    tpmRemaining: num(readHeader(headers, 'x-anoman-rate-remaining-tpm')),
  };
  return Object.values(info).some((v) => v !== undefined) ? info : null;
}

function formatRate(info) {
  if (!info) return '';
  const part = (label, remaining, limit) => {
    if (limit === undefined && remaining === undefined) return null;
    return `${label} sisa ${remaining === undefined ? '?' : remaining}/${limit === undefined ? '?' : limit}`;
  };
  return ['[limit]', info.tier ? `tier=${info.tier}` : null,
    part('rpm', info.rpmRemaining, info.rpmLimit), part('tpm', info.tpmRemaining, info.tpmLimit)]
    .filter(Boolean).join(' | ').replace('[limit] |', '[limit]');
}

function isLow(info, fraction = 0.3) {
  if (!info) return false;
  const low = (rem, lim) => rem !== undefined && lim !== undefined && lim > 0 && rem < lim * fraction;
  return low(info.rpmRemaining, info.rpmLimit) || low(info.tpmRemaining, info.tpmLimit);
}

function describeLimitError(err) {
  const headers = err && (err.headers || (err.response && err.response.headers));
  const info = parseRateHeaders(headers);
  const parts = [];
  const e = err && err.error;
  const code = e && (e.code || (e.error && e.error.code));
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) parts.push(`kode=${code}`);
  if (info) {
    if (info.tier) parts.push(`tier=${info.tier}`);
    if (info.rpmRemaining !== undefined || info.rpmLimit !== undefined) parts.push(`rpm ${info.rpmRemaining ?? '?'}/${info.rpmLimit ?? '?'}`);
    if (info.tpmRemaining !== undefined || info.tpmLimit !== undefined) parts.push(`tpm ${info.tpmRemaining ?? '?'}/${info.tpmLimit ?? '?'}`);
  }
  const ra = num(readHeader(headers, 'retry-after'));
  parts.push(ra !== undefined ? `retry-after=${ra}s` : 'tanpa retry-after');
  const inflight = num(readHeader(headers, 'x-anoman-inflight-cap'));
  if (inflight !== undefined) parts.push(`inflight ${num(readHeader(headers, 'x-anoman-inflight-current')) ?? '?'}/${inflight}`);
  return parts.join(', ');
}

module.exports = { parseRateHeaders, formatRate, isLow, describeLimitError, readHeader };
