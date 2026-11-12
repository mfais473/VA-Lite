'use strict';

const { classifyRateLimit } = require('../rate-limit-retry');

const TRUNCATED_ARGS_ERROR =
  'Keluaran model terpotong karena melewati batas panjang jawaban, sehingga argumen tool tidak lengkap. ' +
  'Pecah menjadi beberapa panggilan atau patch yang lebih kecil, lalu coba lagi.';

function stripImages(messages) {
  return messages.map((m) => {
    if (!m || !m.images || !m.images.length) return m;
    const n = m.images.length;
    const marker = `[${n} gambar tidak dikirim: provider/model ini tidak mendukung gambar]`;
    return { ...m, images: undefined, text: m.text ? `${m.text}\n\n${marker}` : marker };
  });
}

function statusOf(err) {
  for (const c of [err && err.status, err && err.statusCode, err && err.response && err.response.status]) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }
  return undefined;
}

function errorType(err) {
  const e = err && err.error;
  return String((e && (e.type || (e.error && e.error.type))) || (err && err.type) || '');
}

function classifyCommon(err) {
  const status = statusOf(err);
  const type = errorType(err);
  let body = '';
  try { body = typeof err.error === 'string' ? err.error : JSON.stringify(err.error || ''); } catch {}
  const text = `${(err && err.message) || ''} ${(err && err.code) || ''} ${body}`.toLowerCase();

  if (!status && (/econn|enotfound|etimedout|eai_again|fetch failed|connection error|socket hang up|network/.test(text) ||
      /APIConnection/.test((err && err.name) || ''))) return { kind: 'network' };
  if (status === 401 || status === 403 || /authentication_error|permission_error/.test(type)) return { kind: 'auth' };
  if (status === 429 || /rate_limit/.test(type)) {
    const info = classifyRateLimit(err);
    return info.retryable ? { kind: 'rate_limit', waitMs: info.waitMs } : { kind: 'rate_limit' };
  }
  if (status === 529 || status === 503 || /overloaded/.test(type)) return { kind: 'overloaded' };
  if ((status === 400 || status === 413) &&
      /context length|context window|prompt is too long|too many tokens|maximum context|exceeds the (maximum|context)/.test(text)) {
    return { kind: 'context' };
  }
  if (status === 404 || /not_found_error/.test(type) ||
      (status === 400 && /model/.test(text) && /(not found|does not exist|not supported|unknown|invalid)/.test(text))) {
    return { kind: 'model' };
  }
  return { kind: 'other' };
}

const KIND_MESSAGE = {
  auth: 'Kunci API ditolak oleh penyedia. Periksa kunci di Pengaturan.',
  network: 'Tidak bisa menjangkau server penyedia. Periksa koneksi internet atau base URL.',
  model: 'Model tidak ditemukan atau tidak didukung. Periksa nama model di Pengaturan.',
  rate_limit: 'Limit pemakaian penyedia tercapai.',
  overloaded: 'Server penyedia sedang kelebihan beban. Coba lagi sebentar lagi.',
  context: 'Percakapan terlalu panjang untuk model ini.',
  other: 'Panggilan ke penyedia gagal.',
};

const KEY_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\banm-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(x-api-key|authorization|api[_-]?key)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi,
];

function collectSecrets(extra = []) {
  const out = [...extra];
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith('_API_KEY') && typeof v === 'string' && v.length >= 6) out.push(v);
  }
  return out.filter((s) => typeof s === 'string' && s.length >= 6);
}

function redact(text, secrets = []) {
  let s = String(text === undefined || text === null ? '' : text);
  for (const secret of secrets) {
    if (secret) s = s.split(secret).join('[kunci disembunyikan]');
  }
  for (const re of KEY_SHAPES) s = s.replace(re, '[kunci disembunyikan]');
  return s;
}

function userFacingError(err, kind, secrets = []) {
  const base = KIND_MESSAGE[kind] || KIND_MESSAGE.other;
  const raw = redact((err && err.message) || '', collectSecrets(secrets)).replace(/\s+/g, ' ').trim().slice(0, 240);
  const e = new Error(raw && kind === 'other' ? `${base} (${raw})` : base);
  e.kind = kind;
  const status = statusOf(err);
  if (status) e.status = status;
  return e;
}

module.exports = {
  TRUNCATED_ARGS_ERROR, stripImages, classifyCommon, statusOf, redact, collectSecrets, userFacingError, KIND_MESSAGE,
};
