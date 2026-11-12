'use strict';

const MIN_CUSTOM = 1000;
const MAX_CUSTOM = 1000000;

const DEFAULT_LABEL = 'Default (Via tidak mengirim batas)';

function parseLimit(raw) {
  const s = raw === undefined || raw === null ? '' : String(raw).trim();
  if (s === '' || /^default$/i.test(s)) return { mode: 'default', value: null };
  const v = Math.floor(Number(s));
  if (Number.isFinite(v) && v >= 1) return { mode: 'custom', value: v };
  return { mode: 'default', value: null };
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';

function resolveForPhase(phase, env = process.env) {
  const specific = phase === 'coding' ? env.VIA_MAX_OUTPUT_TOKENS_CODING : undefined;
  return parseLimit(present(specific) ? specific : env.VIA_MAX_OUTPUT_TOKENS);
}

function maxOutputTokens(phase, env = process.env) {
  const r = resolveForPhase(phase, env);
  return r.mode === 'custom' ? r.value : 0;
}

function describeLimit(phase, env = process.env) {
  const r = resolveForPhase(phase, env);
  return r.mode === 'custom' ? `${r.value} token` : DEFAULT_LABEL;
}

function validateCustom(value) {
  const s = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
  if (!/^\d{1,8}$/.test(s)) return { ok: false, error: 'Batas harus berupa bilangan bulat positif' };
  const n = Number(s);
  if (n < MIN_CUSTOM || n > MAX_CUSTOM) {
    return { ok: false, error: `Batas harus antara ${MIN_CUSTOM} dan ${MAX_CUSTOM} token` };
  }
  return { ok: true, value: n };
}

module.exports = {
  MIN_CUSTOM, MAX_CUSTOM, DEFAULT_LABEL, parseLimit, resolveForPhase, maxOutputTokens, describeLimit, validateCustom,
};
